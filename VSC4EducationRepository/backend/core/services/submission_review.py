import hashlib
import json
import re
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone

from core.models import Submission
from core.services.safe_zip import (
    ZipValidationError,
    build_name_map,
    find_file,
    read_json,
    read_jsonl,
    validate_zip,
)


ACTION_EVENTS = {
    "file_changed",
    "file_saved",
    "file_created",
    "file_deleted",
    "active_editor_changed",
    "task_started",
    "task_finished",
    "task_completed",
    "submission_exported",
}

PROVIDERS = {"chatGPT", "claude", "copilot"}
PROTECTED_PATTERNS = [
    re.compile(r"^AGENTS\.md$", re.I),
    re.compile(r"^\.vsc4education/", re.I),
    re.compile(r"(^|/)agent/instructions\.md$", re.I),
    re.compile(r"(^|/)(state|events|agent-interactions|current-task)\.jsonl?$", re.I),
    re.compile(r"(^|/)AGENTS\.generated\.md$", re.I),
]
TEST_PATTERN = re.compile(r"(^|/)(tests?|__tests__)/|(\.test|\.spec)\.[^./]+$|(^|/)test_[^/]+\.py$", re.I)
TEST_TASK_PATTERN = re.compile(r"(test|prueba|testing|validacion|validation)", re.I)


class SubmissionReviewService:
    def build(self, submission: Submission) -> dict:
        with zipfile.ZipFile(submission.original_zip.path) as zf:
            validate_zip(zf)
            name_map = build_name_map(zf)
            parsed = self._read_review_inputs(zf, name_map, submission.contribution_id)

        events = parsed["events"]
        interactions = self._validate_interactions(parsed["agent_interactions"], parsed["agent_invalid_lines"])
        return {
            "submissionId": submission.id,
            "studentId": submission.student.institutional_id,
            "contributionId": submission.contribution_id,
            "activityManifest": parsed["activity_manifest"],
            "activityConfiguration": parsed["activity_configuration"],
            "profile": parsed["profile"],
            "state": parsed["state"],
            "summary": self._summary(submission.contribution_id, events, interactions["values"]),
            "agencyMetrics": self._agency_metrics(submission.contribution_id, events, parsed["activity_manifest"]),
            "integrity": self._integrity(parsed["events_raw"], events, parsed["event_invalid_lines"]),
            "events": [self._public_event(event) for event in events],
            "eventParseErrors": parsed["event_invalid_lines"],
            "agentInteractions": interactions["values"],
            "agentInteractionErrors": interactions["errors"],
        }

    def _read_review_inputs(self, zf: zipfile.ZipFile, name_map: dict[str, str], contribution_id: str) -> dict:
        manifest_name = find_file(name_map, ".vsc4education/activity-manifest.json")
        config_name = find_file(name_map, ".vsc4education/activity-configuration.json")
        if not manifest_name or not config_name:
            raise ZipValidationError("Submission ZIP is missing required .vsc4education files")

        base = f".vsc4education/contributions/{contribution_id}/"
        prefix = self._actual_prefix(name_map, base)
        event_name = self._required(name_map, prefix + "events.jsonl")
        agent_name = self._optional(name_map, prefix + "agent-interactions.jsonl")
        events_result = read_jsonl(zf, event_name)
        agent_result = read_jsonl(zf, agent_name) if agent_name else None
        with zf.open(event_name) as fh:
            events_raw = fh.read().decode("utf-8", errors="replace")

        return {
            "activity_manifest": read_json(zf, manifest_name),
            "activity_configuration": read_json(zf, config_name),
            "profile": read_json(zf, self._required(name_map, prefix + "profile.json")),
            "state": read_json(zf, self._required(name_map, prefix + "state.json")),
            "events": events_result.rows,
            "events_raw": events_raw,
            "event_invalid_lines": events_result.invalid_lines,
            "agent_interactions": agent_result.rows if agent_result else [],
            "agent_invalid_lines": agent_result.invalid_lines if agent_result else [],
        }

    def _actual_prefix(self, name_map: dict[str, str], relative_prefix: str) -> str:
        for name in name_map:
            if name.endswith(relative_prefix + "profile.json"):
                return name.rsplit("profile.json", 1)[0]
        return relative_prefix

    def _required(self, name_map: dict[str, str], relative_path: str) -> str:
        name = name_map.get(relative_path) or find_file(name_map, relative_path)
        if not name:
            raise ZipValidationError(f"Submission ZIP is missing {relative_path}")
        return name

    def _optional(self, name_map: dict[str, str], relative_path: str) -> str | None:
        return name_map.get(relative_path) or find_file(name_map, relative_path)

    def _validate_interactions(self, rows: list[dict], invalid_lines: list[dict]) -> dict:
        values = []
        errors = [f"Invalid JSON at line {line.get('line')}" for line in invalid_lines]
        previous = float("-inf")
        for index, row in enumerate(rows, start=1):
            timestamp = self._timestamp(row.get("timestamp"))
            actor = row.get("actor")
            agent = row.get("agent")
            if (
                timestamp is None
                or actor not in {"student", "agent"}
                or not isinstance(row.get("message"), str)
                or (actor == "agent" and (not agent or agent not in PROVIDERS))
            ):
                errors.append(f"Invalid interaction at line {index}")
                continue
            if timestamp < previous:
                errors.append(f"Interaction order is not chronological at line {index}")
            previous = timestamp
            values.append(
                {
                    "timestamp": row.get("timestamp"),
                    "actor": actor,
                    "agent": agent,
                    "message": row.get("message"),
                    "sessionId": row.get("sessionId"),
                    "taskId": row.get("taskId"),
                }
            )
        return {"values": values, "errors": errors}

    def _summary(self, student_id: str, events: list[dict], interactions: list[dict]) -> dict:
        event_types = [self._event_type(event) for event in events]
        files = set()
        touched_lines = set()
        touched_by_file: dict[str, set[int]] = defaultdict(set)
        activity_by_hour = Counter()
        line_touch_count = 0
        file_change_events = 0
        edit_bursts = 0
        previous_edit = None

        for event in events:
            file = self._event_file(event)
            if file:
                files.add(file)
            timestamp = self._timestamp(event.get("timestamp"))
            if timestamp is not None:
                hour = datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).strftime("%H")
                activity_by_hour[hour] += 1
            if self._event_type(event) == "file_changed":
                file_change_events += 1
                if timestamp is not None and (previous_edit is None or timestamp - previous_edit > 120_000):
                    edit_bursts += 1
                previous_edit = timestamp
            for line in self._event_lines(event):
                line_touch_count += 1
                if file:
                    touched_lines.add(f"{file}:{line}")
                    touched_by_file[file].add(line)

        timestamps = sorted(time for time in (self._timestamp(event.get("timestamp")) for event in events) if time is not None)
        idle = 0
        heartbeat_gaps = 0
        for left, right in zip(timestamps, timestamps[1:]):
            gap = right - left
            if gap > 15 * 60_000:
                idle += gap
                heartbeat_gaps += 1
        elapsed = timestamps[-1] - timestamps[0] if len(timestamps) > 1 else 0
        active_minutes = round(max(0, elapsed - idle) / 60_000)
        student_messages = sum(1 for item in interactions if item.get("actor") == "student")
        agent_messages = sum(1 for item in interactions if item.get("actor") == "agent")
        source_files = [file for file in files if re.search(r"\.(ts|tsx|js|jsx|py|java|cs|cpp|c|h|html|css|json|md)$", file, re.I)]
        agency = self._agency_signals(
            {
                "tasks_started": event_types.count("task_started"),
                "tasks_completed": event_types.count("task_completed") + event_types.count("task_finished"),
                "file_change_events": file_change_events,
                "files_modified": len(source_files) or len(files),
                "unique_lines_touched": len(touched_lines),
                "active_minutes": active_minutes,
                "heartbeat_gaps": heartbeat_gaps,
                "student_messages": student_messages,
                "agent_messages": agent_messages,
            }
        )
        return {
            "studentId": student_id,
            "tasksStarted": event_types.count("task_started"),
            "tasksCompleted": event_types.count("task_completed") + event_types.count("task_finished"),
            "saves": event_types.count("file_saved"),
            "commits": event_types.count("git_commit"),
            "filesModified": len(files),
            "sourceFilesModified": len(source_files),
            "lineTouchCount": line_touch_count,
            "uniqueLinesTouched": len(touched_lines),
            "fileChangeEvents": file_change_events,
            "editBursts": edit_bursts,
            "activeMinutes": active_minutes,
            "heartbeatGaps": heartbeat_gaps,
            "agentInteractions": len(interactions),
            "studentAgentMessages": student_messages,
            "agentResponses": agent_messages,
            "activityByHour": [{"hour": hour, "count": count} for hour, count in sorted(activity_by_hour.items())],
            "linesByFile": [{"file": file, "lines": len(lines)} for file, lines in touched_by_file.items()],
            "agency": agency,
        }

    def _agency_metrics(self, student_id: str, events: list[dict], manifest: dict) -> dict:
        views = [self._event_view(event) for event in events]
        sorted_views = sorted([event for event in views if event["time"] is not None], key=lambda event: event["time"])
        heartbeat = self._count(views, "heartbeat")
        actions = [event for event in views if event["type"] in ACTION_EVENTS]
        file_changes = self._by_type(views, "file_changed")
        effective_changes = [event for event in file_changes if event["changeCount"] > 0 or event["lineCount"] > 0]
        saves = self._by_type(views, "file_saved")
        created = self._by_type(views, "file_created")
        deleted = self._by_type(views, "file_deleted")
        exports = [event for event in self._by_type(views, "submission_exported") if event["time"] is not None]
        starts = [event for event in views if event["type"] == "task_started" and event["taskId"] and event["time"] is not None]
        finishes = [event for event in views if event["type"] in {"task_finished", "task_completed"} and event["taskId"] and event["time"] is not None]
        files_changed = {event["file"] for event in file_changes if event["file"]}
        files_saved = {event["file"] for event in saves if event["file"]}
        files_consulted = {event["file"] for event in self._by_type(views, "active_editor_changed") if event["file"]}
        expected = {task.get("file") for task in manifest.get("tasks", []) if isinstance(task, dict) and task.get("file")}
        protected = [event for event in views if event["file"] and self._is_protected(event["file"])]
        session_minutes = self._minutes_between(sorted_views[0]["time"], sorted_views[-1]["time"]) if len(sorted_views) > 1 else 0
        observable_minutes = self._observable_minutes(sorted_views)
        line_visits = Counter()
        for event in file_changes:
            if not event["file"]:
                continue
            for line in event["lines"]:
                line_visits[f"{event['file']}:{line}"] += 1
        unique_lines = len(line_visits)
        total_lines = sum(event["lineCount"] for event in file_changes)
        change_volume = sum(event["changeCount"] for event in file_changes)
        task_durations = self._task_durations(views, starts, finishes)
        hash_discontinuities = self._hash_discontinuities(events)
        temporal_gaps = len([gap for gap in self._pauses([event for event in sorted_views if event["type"] != "heartbeat"]) if gap >= 15])
        expected_touched = [file for file in expected if file in files_changed]
        top_file_count = max(Counter(event["file"] or "-" for event in file_changes).values() or [0])
        changes_after_export = self._after_last(exports, [event for event in views if event["type"] in {"file_changed", "file_saved", "file_created"}])
        massive_changes = [event for event in file_changes if event["lineCount"] > 20 or event["changeCount"] > 20]
        incremental = [event for event in effective_changes if event["changeCount"] <= 1 and 0 < event["lineCount"] <= 3]
        systemic = [
            event
            for event in views
            if event["type"] == "heartbeat"
            or event["type"] == "agents_file_restored"
            or (event["file"] and self._is_protected(event["file"]))
            or (event["type"] == "file_changed" and event["changeCount"] == 0 and event["lineCount"] == 0)
        ]

        groups = [
            self._group(
                "Presencia y continuidad",
                [
                    self._metric(1, False, "Tiempo total de sesion", self._round(session_minutes), "min", "Primer evento hasta ultimo evento.", "Duracion bruta del registro; no equivale por si sola a trabajo efectivo.", len(sorted_views), "direct"),
                    self._metric(2, True, "Tiempo activo dentro de tareas", self._round(sum(item["minutes"] for item in task_durations)), "min", self._task_duration_detail(task_durations), "Tiempo entre inicio y cierre de tarea, estimado si falta cierre.", len(task_durations), "estimated" if any(item["estimated"] for item in task_durations) else "direct"),
                    self._metric(3, True, "Tiempo con actividad observable", self._round(observable_minutes), "min", "Ventanas de 3 minutos con al menos una accion no pasiva.", "Filtra periodos donde solo hay heartbeat o presencia pasiva.", len(actions), "estimated"),
                    self._metric(4, True, "Ratio de actividad efectiva", self._ratio(len(actions), heartbeat), None, "Acciones observables divididas por heartbeat.", "Un valor alto sugiere interaccion activa frente a presencia pasiva.", len(actions), "direct"),
                ],
            ),
            self._group(
                "Intensidad de edicion",
                [
                    self._metric(5, True, "Densidad de edicion", self._ratio(len(file_changes), observable_minutes), "cambios/min", "Eventos file_changed por minuto observable.", "Densidades extremas requieren revisar contexto.", len(file_changes), "estimated"),
                    self._metric(6, True, "Proporcion de cambios efectivos", self._percent(len(effective_changes), len(file_changes)), "%", "file_changed con changeCount o lineas sobre total.", "Distingue cambios materiales de ruido tecnico.", len(effective_changes), "direct"),
                    self._metric(7, True, "Volumen total de cambios", change_volume, None, "Suma de data.changeCount en file_changed.", "Volumen bruto; debe interpretarse junto con lineas y ritmo.", len(file_changes), "direct"),
                    self._metric(8, False, "Lineas afectadas totales", total_lines, None, "Suma de rangos data.lines.", "Aproxima alcance textual, contando repeticiones.", len(file_changes), "direct"),
                    self._metric(9, True, "Lineas unicas modificadas", unique_lines, None, "Lineas archivo:numero distintas.", "Evita contar varias visitas a la misma linea.", unique_lines, "direct"),
                ],
            ),
            self._group(
                "Relevancia de la intervencion",
                [
                    self._metric(11, False, "Concentracion de edicion por archivo", self._percent(top_file_count, len(file_changes)), "%", "Porcentaje de cambios en el archivo dominante.", "Muestra si el esfuerzo se concentra en un archivo.", len(file_changes), "direct"),
                    self._metric(12, True, "Cobertura de archivos esperados", self._percent(len(expected_touched), len(expected)) if expected else "n/d", "%" if expected else None, f"{len(expected_touched)}/{len(expected)} archivos de tareas modificados." if expected else "El manifiesto no declara task.file.", "Una cobertura baja puede ser incompletitud o estrategia alternativa valida.", len(expected_touched), "direct" if expected else "limited"),
                    self._metric(13, True, "Actividad en archivos no esperados o protegidos", len(protected) + len(self._non_expected_events(views, expected)), None, "Acciones sobre rutas protegidas o fuera de task.file cuando existe.", "Indicador de revision contextual; no implica mala praxis automaticamente.", len(protected), "estimated" if expected else "limited"),
                ],
            ),
            self._group(
                "Gestion del proceso",
                [
                    self._metric(18, True, "Guardados por tarea", self._round(self._average(Counter(event["taskId"] or "outside task" for event in saves).values())), None, "Promedio de file_saved por tarea.", "Muchos guardados pueden indicar ciclos incrementales; cero puede depender de autoguardado.", len(saves), "direct"),
                    self._metric(19, True, "Ratio cambios por guardado", self._ratio(len(effective_changes), len(saves)), None, "file_changed efectivos dividido por file_saved.", "Relaciona edicion con persistencia.", len(effective_changes) + len(saves), "direct"),
                    self._metric(25, False, "Finalizacion explicita de tareas", self._percent(len(finishes), len(starts)), "%", f"{len(finishes)}/{max(1, len(starts))} tareas iniciadas tienen cierre.", "Senal de control del flujo pedagogico.", len(starts) + len(finishes), "direct"),
                ],
            ),
            self._group(
                "Control de entrega",
                [
                    self._metric(23, False, "Numero de exportaciones de entrega", len(exports), None, "count(submission_exported).", "Varias exportaciones pueden indicar iteracion o pruebas administrativas.", len(exports), "direct"),
                    self._metric(30, True, "Cambios posteriores a la entrega", changes_after_export, None, "Cambios, guardados o creaciones tras la ultima exportacion registrada.", "Puede indicar que la ultima version del workspace no coincide con la entrega exportada.", changes_after_export, "direct" if exports else "limited"),
                    self._metric(50, False, "Indice de trazabilidad de la entrega", self._percent(self._traceability_score(len(files_changed), len([file for file in files_changed if file in files_saved]), len(starts), len(finishes), len(exports), hash_discontinuities), 1), "%", "Combina archivos cambiados, guardados, cierres, exportacion e integridad hash.", "Resume cuan explicable es la entrega final desde el log.", len(events), "estimated"),
                ],
            ),
            self._group(
                "Patrones de edicion",
                [
                    self._metric(32, False, "Cambios masivos repentinos", len(massive_changes), None, "file_changed con mas de 20 lineas o changeCount mayor a 20.", "Senal para revisar pegado, formateo, generacion o reemplazos amplios.", len(massive_changes), "estimated"),
                    self._metric(33, False, "Indice de edicion incremental", self._percent(len(incremental), len(effective_changes)), "%", "Cambios pequenos sobre cambios efectivos.", "Compatible con construccion paso a paso cuando es alto.", len(incremental), "estimated"),
                    self._metric(35, False, "Pausas entre acciones activas", self._pause_detail(self._pauses([event for event in sorted_views if event["type"] != "heartbeat"])), None, "Diferencias entre acciones no-heartbeat.", "Las pausas pueden ser lectura, consulta, bloqueo o trabajo externo.", len(actions), "direct"),
                ],
            ),
            self._group(
                "Exploracion y lectura",
                [
                    self._metric(37, True, "Numero de archivos consultados", len(files_consulted), None, "Archivos distintos en active_editor_changed.", "Mide amplitud de exploracion del proyecto.", len(files_consulted), "direct"),
                    self._metric(38, False, "Ratio archivos consultados sobre modificados", self._ratio(len(files_consulted), len(files_changed)), None, "Archivos consultados dividido por archivos modificados.", "Valores altos sugieren busqueda de contexto o exploracion dispersa.", len(files_consulted) + len(files_changed), "direct"),
                ],
            ),
            self._group(
                "Validacion y pruebas",
                [
                    self._metric(43, False, "Actividad sobre tests", len([event for event in views if event["file"] and TEST_PATTERN.search(event["file"]) and event["type"] in ACTION_EVENTS]), None, "Acciones sobre rutas de tests o archivos *.test/*.spec/test_*.py.", "Indica trabajo orientado a comprobar la solucion cuando aplica.", len(views), "estimated"),
                    self._metric(44, False, "Actividad asociada a tarea de pruebas", len([event for event in views if event["taskId"] and TEST_TASK_PATTERN.search(event["taskId"]) and event["type"] in ACTION_EVENTS]), None, "Acciones en taskId relacionado con pruebas o validacion.", "Mide actividad visible en tareas de verificacion.", len(views), "estimated"),
                ],
            ),
            self._group(
                "Autonomia frente al sistema",
                [
                    self._metric(17, False, "Restauraciones automaticas del sistema", self._count(views, "agents_file_restored"), None, "count(agents_file_restored).", "Valores altos sugieren conflicto con archivos gestionados.", self._count(views, "agents_file_restored"), "direct"),
                    self._metric(45, False, "Indice de autonomia de edicion", self._percent(len([event for event in views if event["type"] in {"file_changed", "file_saved", "file_created", "file_deleted", "active_editor_changed"}]), max(1, len(events) - heartbeat)), "%", "Acciones directas observables sobre eventos no-heartbeat.", "Separa interaccion humana observable de ruido sistemico.", len(events), "estimated"),
                    self._metric(46, False, "Indice de dependencia sistemica", self._percent(len(systemic), len(events)), "%", "Heartbeat, restauraciones, protegidos o cambios sin efecto sobre total eventos.", "Si es alto, conviene filtrar antes de interpretar agencia.", len(systemic), "estimated"),
                ],
            ),
            self._group(
                "Integridad y cumplimiento",
                [
                    self._metric(47, False, "Manipulacion o alteracion de archivos protegidos", len(protected), None, "Acciones sobre AGENTS.md, .vsc4education o metadatos internos.", "Indicador de revision, nunca acusacion automatica.", len(protected), "estimated"),
                    self._metric(48, True, "Integridad de la cadena hash", "continua" if hash_discontinuities == 0 else f"{hash_discontinuities} discontinuidades", None, "Comprueba previousHash contra hash anterior.", "Afecta la confianza en la trazabilidad del log.", len(events), "direct"),
                    self._metric(49, False, "Discontinuidades temporales", temporal_gaps, None, "Pausas de 15 minutos o mas entre acciones no-heartbeat.", "Ayuda a no sobreinterpretar ausencia de eventos.", temporal_gaps, "direct"),
                ],
            ),
        ]
        return {"studentId": student_id, "groups": groups}

    def _integrity(self, content: str, events: list[dict], invalid_lines: list[dict]) -> dict:
        if not content.strip():
            return {"status": "not_available", "checkedEntries": 0, "message": "No event chain is available"}
        if invalid_lines:
            return {
                "status": "incomplete",
                "checkedEntries": len(events),
                "firstInvalidLine": invalid_lines[0].get("line"),
                "message": f"Invalid JSON at line {invalid_lines[0].get('line')}",
            }
        previous_hash = None
        for index, event in enumerate(events):
            event_hash = event.get("hash")
            if event.get("previousHash") != previous_hash or not isinstance(event_hash, str):
                return {
                    "status": "invalid",
                    "checkedEntries": index,
                    "firstInvalidLine": index + 1,
                    "message": f"Broken previousHash link at line {index + 1}",
                }
            without_hash = {key: value for key, value in event.items() if key != "hash"}
            calculated = hashlib.sha256(f"{previous_hash or ''}{self._canonical_json(without_hash)}".encode("utf-8")).hexdigest()
            if calculated != event_hash:
                return {
                    "status": "invalid",
                    "checkedEntries": index,
                    "firstInvalidLine": index + 1,
                    "message": f"Hash mismatch at line {index + 1}",
                }
            previous_hash = event_hash
        return {
            "status": "valid",
            "checkedEntries": len(events),
            "message": "The local chain is internally consistent; this does not prove absolute authenticity",
        }

    def _event_view(self, event: dict) -> dict:
        lines = self._event_lines(event)
        return {
            "event": event,
            "type": self._event_type(event) or "event",
            "time": self._timestamp(event.get("timestamp")),
            "taskId": event.get("taskId") if isinstance(event.get("taskId"), str) else None,
            "file": self._event_file(event),
            "changeCount": event.get("data", {}).get("changeCount") if isinstance(event.get("data"), dict) and isinstance(event.get("data", {}).get("changeCount"), (int, float)) else len(lines),
            "lineCount": len(lines),
            "lines": lines,
        }

    def _public_event(self, event: dict) -> dict:
        return {key: value for key, value in event.items() if key not in {"content", "fileContent"}}

    def _canonical_json(self, value) -> str:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

    def _event_type(self, event: dict) -> str | None:
        return event.get("type") if isinstance(event.get("type"), str) else event.get("event") if isinstance(event.get("event"), str) else None

    def _event_file(self, event: dict) -> str | None:
        if isinstance(event.get("file"), str):
            return event["file"].replace("\\", "/").lstrip("./")
        data = event.get("data")
        if isinstance(data, dict) and isinstance(data.get("file"), str):
            return data["file"].replace("\\", "/").lstrip("./")
        return None

    def _event_lines(self, event: dict) -> list[int]:
        data = event.get("data")
        raw = data.get("lines") if isinstance(data, dict) else None
        if not isinstance(raw, list):
            return []
        lines = set()
        for item in raw:
            if not isinstance(item, dict) or not isinstance(item.get("start"), (int, float)) or not isinstance(item.get("end"), (int, float)):
                continue
            start = int(min(item["start"], item["end"]))
            end = int(max(item["start"], item["end"]))
            lines.update(range(start, end + 1))
        return sorted(lines)

    def _timestamp(self, value) -> float | None:
        if not isinstance(value, str):
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000
        except ValueError:
            return None

    def _agency_signals(self, input: dict) -> dict:
        positives = []
        concerns = []
        score = 0
        if input["tasks_started"] > 0:
            score += 1
            positives.append("Inicio de tarea registrado")
        if input["file_change_events"] >= 3 or input["unique_lines_touched"] >= 5:
            score += 2
            positives.append("Hay ediciones sostenidas en archivos de trabajo")
        elif input["file_change_events"] > 0:
            score += 1
            positives.append("Hay cambios propios registrados")
        else:
            concerns.append("No se registran cambios de archivo suficientes")
        if input["files_modified"] > 1:
            score += 1
            positives.append("Trabajo distribuido en mas de un archivo")
        if input["active_minutes"] >= 10:
            score += 1
            positives.append("Sesion de trabajo con duracion observable")
        if input["tasks_completed"] > 0:
            score += 1
            positives.append("Cierre de tarea registrado")
        if input["student_messages"] > 0 and input["agent_messages"] > 0:
            score += 1
            positives.append("Uso dialogado del agente")
        if input["agent_messages"] > input["student_messages"] * 3 and input["file_change_events"] < 3:
            concerns.append("Mucha respuesta del agente con poca edicion posterior")
            score -= 1
        if input["heartbeat_gaps"] > 0:
            concerns.append("Hay pausas largas entre eventos; revisar continuidad")
        return {"score": max(0, min(6, score)), "level": "alta" if score >= 5 else "media" if score >= 3 else "baja", "positives": positives, "concerns": concerns}

    def _group(self, dimension: str, metrics: list[dict]) -> dict:
        return {"dimension": dimension, "metrics": metrics}

    def _metric(self, id: int, priority: bool, name: str, value, unit: str | None, detail: str, interpretation: str, evidence_count: int, reliability: str) -> dict:
        return {"id": id, "priority": priority, "name": name, "value": value, "unit": unit, "detail": detail, "interpretation": interpretation, "evidenceCount": evidence_count, "reliability": reliability}

    def _by_type(self, events: list[dict], event_type: str) -> list[dict]:
        return [event for event in events if event["type"] == event_type]

    def _count(self, events: list[dict], event_type: str) -> int:
        return len(self._by_type(events, event_type))

    def _is_protected(self, file: str) -> bool:
        return any(pattern.search(file) for pattern in PROTECTED_PATTERNS)

    def _minutes_between(self, start: float | None, end: float | None) -> float:
        return (end - start) / 60_000 if start is not None and end is not None and end >= start else 0

    def _observable_minutes(self, events: list[dict]) -> int:
        return len({int(event["time"] // (3 * 60_000)) for event in events if event["time"] is not None and event["type"] in ACTION_EVENTS}) * 3

    def _round(self, value: float) -> float:
        return round(value, 1)

    def _ratio(self, numerator: float, denominator: float) -> float:
        return self._round(numerator / max(1, denominator))

    def _percent(self, numerator: float, denominator: float) -> float:
        return self._round((numerator / max(1, denominator)) * 100)

    def _average(self, values) -> float:
        values = list(values)
        return sum(values) / len(values) if values else 0

    def _task_durations(self, events: list[dict], starts: list[dict], finishes: list[dict]) -> list[dict]:
        result = []
        for start in starts:
            finish = next((item for item in finishes if item["taskId"] == start["taskId"] and item["time"] >= start["time"]), None)
            task_events = [item for item in events if item["taskId"] == start["taskId"] and item["time"] is not None]
            end = finish["time"] if finish else task_events[-1]["time"] if task_events else start["time"]
            result.append({"taskId": start["taskId"], "minutes": self._minutes_between(start["time"], end), "estimated": finish is None})
        return result

    def _task_duration_detail(self, values: list[dict]) -> str:
        return "; ".join(f"{item['taskId']}: {self._round(item['minutes'])} min{' estimado' if item['estimated'] else ''}" for item in values) or "No hay task_started con timestamp."

    def _hash_discontinuities(self, events: list[dict]) -> int:
        return sum(1 for index in range(1, len(events)) if events[index].get("previousHash") != events[index - 1].get("hash"))

    def _pauses(self, events: list[dict]) -> list[float]:
        times = sorted(event["time"] for event in events if event["time"] is not None)
        return [self._round((right - left) / 60_000) for left, right in zip(times, times[1:])]

    def _pause_detail(self, values: list[float]) -> str:
        if not values:
            return "Sin pausas calculables."
        ordered = sorted(values)
        median = ordered[len(ordered) // 2]
        p90 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.9))]
        return f"mediana {median} min, p90 {p90} min, >5 min: {len([value for value in values if value > 5])}."

    def _after_last(self, exports: list[dict], events: list[dict]) -> int:
        last_export = exports[-1]["time"] if exports else None
        return 0 if last_export is None else len([event for event in events if event["time"] is not None and event["time"] > last_export])

    def _traceability_score(self, changed_files: int, saved_touched_files: int, starts: int, finishes: int, exports: int, hash_discontinuities: int) -> float:
        parts = [
            min(1, saved_touched_files / changed_files) if changed_files else 0,
            min(1, finishes / starts) if starts else 0,
            1 if exports else 0,
            1 if hash_discontinuities == 0 else 0,
        ]
        return self._average(parts)

    def _non_expected_events(self, events: list[dict], expected: set[str]) -> list[dict]:
        if not expected:
            return []
        return [event for event in events if event["file"] and event["type"] in ACTION_EVENTS and event["file"] not in expected]
