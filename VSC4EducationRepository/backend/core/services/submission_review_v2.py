"""Segundo motor de metricas de agencia ("v2").

Implementa la especificacion completa de
`.no_sync/metrics-future-work/metrics-new-approach.md`: en vez de un unico
"observableAgency" mezclado, produce cuatro indices independientes
(Trazabilidad, Compromiso/Proceso, Autoria, Soporte de Agentes) mas un
resumen ejecutivo derivado.

Este modulo es deliberadamente autonomo: no importa metodos privados de
`submission_review.py` (ver ese archivo para el motor v1, que sigue
funcionando sin cambios). Solo se reutilizan los helpers genericos y ya
publicos de `safe_zip.py` y `evidence_crypto.py` para abrir el zip y
descifrar eventos; el resto del parsing (event view, deteccion de archivos
protegidos, calculo de pausas, etc.) se duplica aqui en su version minima
necesaria, tal como pide la tarea, para mantener v1 y v2 totalmente
desacoplados.

Referencias de metricas "antes metric NN": la mayoria de esas metricas no
viven todas en `submission_review.py` (que solo implementa un subconjunto);
el resto existe en el motor TypeScript equivalente
`VSC4EducationTeacher/src/services/AgencyMetricsService.ts` (mismo
repositorio de proyecto, extension de docente). Las formulas T1-T5/C1-C35
de este archivo replican esas formulas originales renombrando los ids segun
la seccion 2 del documento de especificacion.
"""

import re
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone

from core.models import Submission
from core.services.evidence_crypto import decrypt_events, read_private_key_from_activity
from core.services.safe_zip import (
    ZipValidationError,
    build_name_map,
    find_file,
    read_json,
    read_jsonl,
    validate_zip,
)

METRICS_SCHEMA_VERSION = "2.0.0"

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

PROTECTED_PATTERNS = [
    re.compile(r"^AGENTS\.md$", re.I),
    re.compile(r"^\.vsc4education/", re.I),
    re.compile(r"(^|/)agent/instructions\.md$", re.I),
    re.compile(r"(^|/)(state|events|agent-interactions|agent-evidence|agent-evidence-state|current-task)\.jsonl?$", re.I),
    re.compile(r"(^|/)AGENTS\.generated\.md$", re.I),
]
VARIANT_PATTERN = re.compile(r"(^|[._ -])(copy|copia|backup|old|v\d+|final|prueba|\d+)([._ -]|$)", re.I)
TEST_PATTERN = re.compile(r"(^|/)(tests?|__tests__)/|(\.test|\.spec)\.[^./]+$|(^|/)test_[^/]+\.py$", re.I)
TEST_TASK_PATTERN = re.compile(r"(test|prueba|testing|validacion|validation)", re.I)
PROTECTED_EDIT_WINDOW_MS = 10 * 60 * 1000

# --- Umbrales fijos (Modo B de la seccion 3: "umbral fijo documentado").
# Todos son provisionales, ver metrics-new-approach.md seccion 3, y deberian
# migrar a normalizacion por percentil de cohorte (Modo A, n>=8) en una
# iteracion futura; ese modo no se implementa aqui porque build() opera
# sobre una unica entrega, sin visibilidad del resto de la cohorte.
C2_FULL_SCORE_MINUTES = 30  # provisional, ver metrics-new-approach.md seccion 3
C3_FULL_SCORE_MINUTES = 30  # provisional, ver metrics-new-approach.md seccion 3 (mismo orden que C2)
C4_FULL_SCORE_RATIO = 1.0  # provisional, ver metrics-new-approach.md seccion 3
C6_DENSITY_BAND = (0.1, 4)  # provisional, ver metrics-new-approach.md seccion 3
C8_FULL_SCORE_VOLUME = 30  # provisional, ver metrics-new-approach.md seccion 3
C9_FULL_SCORE_LINES = 40  # provisional, sin equivalente explicito en la tabla del spec; extrapolado desde C8
C10_FULL_SCORE_UNIQUE_LINES = 20  # provisional, ver metrics-new-approach.md seccion 3
C11_FULL_SCORE_DISPERSION = 50  # provisional, sin equivalente explicito en el spec; orden de magnitud de C28 (>20 lineas)
C13_ZERO_AT_PERCENT = 100  # provisional, ver metrics-new-approach.md seccion 3 (heredado de v1)
C14_FULL_SCORE_ZONES = 4  # provisional, heredado del motor TS (cap sobre zonas funcionales)
C16_FULL_SCORE_SAVES_PER_TASK = 3  # provisional, heredado de v1
C17_BAND = (0.5, 8)  # provisional, heredado de v1
C18_ZERO_AT_MINUTES = 30  # provisional, sin equivalente en v1; mismo orden que C2
C19_ZERO_AT_MINUTES = 45  # provisional, sin equivalente en v1; algo mas laxo que C18
C22_ZERO_AT_PERCENT = 100  # provisional, heredado del motor TS (metric 29)
C26_FULL_SCORE_COUNT = 3  # provisional, heredado de v1
C27_FULL_SCORE_COUNT = 3  # provisional, heredado de v1
C29_BLOCK_GAP_MS = 30_000  # provisional, ver metrics-new-approach.md seccion 2.2 (C29: bloques de >=30s)
C29_SMALL_BLOCK_LINES = 3  # provisional: umbral de "bloque pequeno" para el indice incremental agregado

A1_SMALL_EVENT_MAX_LINES = 2  # provisional, ver metrics-new-approach.md seccion 3 (umbral de "evento pequeno")
A2_FULL_SCORE_MAX_LINES = 2  # provisional, ver metrics-new-approach.md seccion 3 (banda inversa de A2)
A2_ZERO_SCORE_MAX_LINES = 15  # provisional, ver metrics-new-approach.md seccion 3 (banda inversa de A2)
A3_MIN_GAP_MS = 40  # provisional, ver metrics-new-approach.md seccion 2.3 (cadencia humana de tecleo)
A3_MAX_GAP_MS = 2000  # provisional, ver metrics-new-approach.md seccion 2.3 (cadencia humana de tecleo)
A6_FULL_SCORE_BLOCKS = 4  # provisional, heredado del motor TS (metric 40)
A6_REFINEMENT_GAP_MS = 2 * 60_000  # provisional, ver metrics-new-approach.md seccion 2.3 (A6: >2 min separa bloques)
A7_READ_EDIT_WINDOW_MS = 5 * 60_000  # ver metrics-new-approach.md seccion 2.3 (A7: 5 min, distinto del viejo metric 36 que usaba 10 min)
UNIFORMITY_CV_THRESHOLD = 0.15  # provisional, ver metrics-new-approach.md seccion 2.3 ("p. ej. CV < 0.15")
UNIFORMITY_MIN_BURST_EVENTS = 5  # provisional, ver metrics-new-approach.md seccion 2.3 (">=5 eventos")

S3_WINDOW_MS = 10 * 60_000  # ver metrics-new-approach.md seccion 2.4 (S3: ventana de 10 minutos)
AGENT_SUPPORT_HIGH_THRESHOLD = 50  # provisional: umbral de "soporte alto" para la matriz de interpretacion (seccion 5.5)

TEMPORAL_GAP_MINUTES = 15  # ver metrics-new-approach.md seccion 2.1/2.2 (T9/C5: pausas >=15 min)

TRACEABILITY_SUBORDINATION_THRESHOLD = 40  # ver metrics-new-approach.md seccion 6
AUTHORSHIP_LOW_THRESHOLD = 40  # ver metrics-new-approach.md seccion 6

ENGAGEMENT_SUBDIM_WEIGHTS = {
    "presencia": 0.20,
    "intensidad": 0.25,
    "alineacion": 0.20,
    "gestionProceso": 0.20,
    "validacion": 0.15,
}
AUTHORSHIP_WEIGHTS = {"A1": 0.35, "A2": 0.20, "A3": 0.15, "A4": 0.10, "A5": 0.10, "A6": 0.10}
AGENT_SUPPORT_WEIGHTS = {"S3": 0.55, "S1": 0.45}
SUMMARY_WEIGHTS = {"traceability": 0.20, "engagement": 0.30, "authorship": 0.40, "agentSupport": 0.10}


class SubmissionReviewServiceV2:
    def build(self, submission: Submission) -> dict:
        with zipfile.ZipFile(submission.original_zip.path) as zf:
            validate_zip(zf)
            name_map = build_name_map(zf)
            parsed = self._read_zip_inputs(zf, name_map, submission.contribution_id)

        private_key = read_private_key_from_activity(submission.activity_version)
        events, _decrypt_warnings = decrypt_events(parsed["events"], private_key)
        interactions = self._valid_interactions(parsed["agent_interactions"])
        manifest = parsed["activity_manifest"] if isinstance(parsed["activity_manifest"], dict) else {}

        context = self._build_context(events, manifest)
        atoms: dict = {}

        traceability = self._traceability(context, events, atoms)
        engagement = self._engagement(context, manifest, atoms)
        authorship = self._authorship(context, atoms)
        agent_support = self._agent_support(context, interactions, atoms)

        has_agent_data = len(interactions) > 0
        interpretation_flag = self._interpretation_flag(authorship["score"], agent_support["score"], has_agent_data)
        summary = self._summary(traceability, engagement, authorship, agent_support)

        return {
            "submissionId": submission.id,
            "studentId": submission.student.institutional_id,
            "contributionId": submission.contribution_id,
            "metricsSchemaVersion": METRICS_SCHEMA_VERSION,
            "atoms": atoms,
            "traceability": traceability,
            "engagement": engagement,
            "authorship": authorship,
            "agentSupport": agent_support,
            "interpretationFlag": interpretation_flag,
            "summary": summary,
        }

    # ------------------------------------------------------------------
    # Lectura de zip / eventos (duplicado minimo, ver submission_review.py)
    # ------------------------------------------------------------------
    def _read_zip_inputs(self, zf, name_map: dict[str, str], contribution_id: str) -> dict:
        manifest_name = find_file(name_map, ".vsc4education/activity-manifest.json")
        if not manifest_name:
            raise ZipValidationError("Submission ZIP is missing required .vsc4education files")

        base = f".vsc4education/contributions/{contribution_id}/"
        prefix = self._actual_prefix(name_map, base)
        event_name = self._required(name_map, prefix + "events.jsonl")
        agent_name = self._optional(name_map, prefix + "agent-interactions.jsonl")
        events_result = read_jsonl(zf, event_name)
        agent_result = read_jsonl(zf, agent_name) if agent_name else None

        return {
            "activity_manifest": read_json(zf, manifest_name),
            "events": events_result.rows,
            "agent_interactions": agent_result.rows if agent_result else [],
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

    def _valid_interactions(self, rows: list[dict]) -> list[dict]:
        values = []
        for row in rows:
            timestamp = self._timestamp(row.get("timestamp"))
            actor = row.get("actor")
            message = row.get("message")
            if timestamp is None or actor not in {"student", "agent"} or not isinstance(message, str):
                continue
            values.append(
                {
                    "time": timestamp,
                    "actor": actor,
                    "message": message,
                    "taskId": row.get("taskId") if isinstance(row.get("taskId"), str) else None,
                }
            )
        return values

    # ------------------------------------------------------------------
    # Parsing de eventos (identico en forma a submission_review._event_view)
    # ------------------------------------------------------------------
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

    def _event_type(self, event: dict) -> str | None:
        return event.get("type") if isinstance(event.get("type"), str) else event.get("event") if isinstance(event.get("event"), str) else None

    def _event_file(self, event: dict) -> str | None:
        if isinstance(event.get("file"), str):
            return self._normalize_path(event["file"])
        data = event.get("data")
        if isinstance(data, dict) and isinstance(data.get("file"), str):
            return self._normalize_path(data["file"])
        return None

    def _normalize_path(self, file: str) -> str:
        return file.replace("\\", "/").lstrip("./")

    def _is_work_source_file(self, file: str) -> bool:
        return self._normalize_path(file).startswith("src/")

    def _is_protected(self, file: str) -> bool:
        return any(pattern.search(file) for pattern in PROTECTED_PATTERNS)

    def _timestamp(self, value) -> float | None:
        if not isinstance(value, str):
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000
        except ValueError:
            return None

    def _timestamp_label(self, value: float | None) -> str:
        if value is None:
            return "hora desconocida"
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).strftime("%H:%M")

    # ------------------------------------------------------------------
    # Contexto compartido: colecciones derivadas de los eventos, reutilizadas
    # por trazabilidad/compromiso/autoria/soporte para no recalcular nada dos
    # veces.
    # ------------------------------------------------------------------
    def _build_context(self, events: list[dict], manifest: dict) -> dict:
        views = [self._event_view(event) for event in events]
        sorted_views = sorted([view for view in views if view["time"] is not None], key=lambda view: view["time"])
        work_views = [view for view in views if not view["file"] or self._is_work_source_file(view["file"])]
        work_file_views = [view for view in views if view["file"] and self._is_work_source_file(view["file"])]
        actions = [view for view in work_views if view["type"] in ACTION_EVENTS]
        file_changes = [view for view in work_file_views if view["type"] == "file_changed"]
        effective_changes = [view for view in file_changes if view["changeCount"] > 0 or view["lineCount"] > 0]
        saves = [view for view in work_file_views if view["type"] == "file_saved"]
        created = [view for view in work_file_views if view["type"] == "file_created"]
        deleted = [view for view in work_file_views if view["type"] == "file_deleted"]
        exports = [view for view in views if view["type"] == "submission_exported" and view["time"] is not None]
        starts = [view for view in views if view["type"] == "task_started" and view["time"] is not None]
        finishes = [view for view in views if view["type"] in {"task_finished", "task_completed"} and view["time"] is not None]
        files_changed = {view["file"] for view in file_changes if view["file"]}
        files_saved = {view["file"] for view in saves if view["file"]}
        files_consulted = {view["file"] for view in work_file_views if view["type"] == "active_editor_changed" and view["file"]}
        expected = {
            self._normalize_path(task.get("file"))
            for task in (manifest.get("tasks") or [])
            if isinstance(task, dict) and task.get("file") and self._is_work_source_file(task.get("file"))
        }
        protected_sequences = self._protected_edit_sequences(views)
        outside_src = [view for view in views if view["file"] and not self._is_work_source_file(view["file"]) and view["type"] in ACTION_EVENTS]
        session_minutes = self._minutes_between(sorted_views[0]["time"], sorted_views[-1]["time"]) if len(sorted_views) > 1 else 0
        observable_minutes = self._observable_minutes(sorted_views)
        task_durations = self._task_durations(views, starts, finishes)
        hash_discontinuities = self._hash_discontinuities(events)
        non_heartbeat_sorted = [view for view in sorted_views if view["type"] != "heartbeat"]
        active_pauses = self._pauses(non_heartbeat_sorted)
        temporal_gaps = len([gap for gap in active_pauses if gap >= TEMPORAL_GAP_MINUTES])
        restorations_count = len([view for view in views if view["type"] == "agents_file_restored"])

        return {
            "views": views,
            "sorted_views": sorted_views,
            "work_views": work_views,
            "work_file_views": work_file_views,
            "actions": actions,
            "file_changes": file_changes,
            "effective_changes": effective_changes,
            "saves": saves,
            "created": created,
            "deleted": deleted,
            "exports": exports,
            "starts": starts,
            "finishes": finishes,
            "files_changed": files_changed,
            "files_saved": files_saved,
            "files_consulted": files_consulted,
            "expected": expected,
            "protected_sequences": protected_sequences,
            "outside_src": outside_src,
            "session_minutes": session_minutes,
            "observable_minutes": observable_minutes,
            "task_durations": task_durations,
            "hash_discontinuities": hash_discontinuities,
            "active_pauses": active_pauses,
            "temporal_gaps": temporal_gaps,
            "restorations_count": restorations_count,
        }

    def _protected_edit_sequences(self, events: list[dict]) -> list[dict]:
        ordered = sorted([event for event in events if event["time"] is not None], key=lambda event: event["time"])
        sequences = []
        protected_open = None
        for event in ordered:
            if event["type"] == "active_editor_changed" and event["file"]:
                protected_open = event if self._is_protected(event["file"]) else None
                continue
            if (
                protected_open
                and event["type"] in {"file_changed", "file_saved", "file_created", "file_deleted"}
                and event["time"] - protected_open["time"] <= PROTECTED_EDIT_WINDOW_MS
                and (not event["file"] or event["file"] == protected_open["file"])
            ):
                sequences.append({"opened": protected_open, "change": event, "file": protected_open["file"]})
                protected_open = None
            if protected_open and event["time"] - protected_open["time"] > PROTECTED_EDIT_WINDOW_MS:
                protected_open = None
        return sequences

    def _hash_discontinuities(self, events: list[dict]) -> int:
        return sum(1 for index in range(1, len(events)) if events[index].get("previousHash") != events[index - 1].get("hash"))

    def _task_durations(self, events: list[dict], starts: list[dict], finishes: list[dict]) -> list[dict]:
        result = []
        for start in starts:
            finish = next((item for item in finishes if item["taskId"] == start["taskId"] and item["time"] >= start["time"]), None)
            task_events = [item for item in events if item["taskId"] == start["taskId"] and item["time"] is not None]
            end = finish["time"] if finish else task_events[-1]["time"] if task_events else start["time"]
            result.append({"taskId": start["taskId"], "minutes": self._minutes_between(start["time"], end), "estimated": finish is None})
        return result

    def _pauses(self, events: list[dict]) -> list[float]:
        times = sorted(event["time"] for event in events if event["time"] is not None)
        return [self._round((right - left) / 60_000) for left, right in zip(times, times[1:])]

    # ------------------------------------------------------------------
    # Utilidades numericas / de normalizacion
    # ------------------------------------------------------------------
    def _round(self, value: float) -> float:
        return round(value, 1)

    def _ratio(self, numerator: float, denominator: float) -> float:
        return self._round(numerator / max(1, denominator))

    def _percent(self, numerator: float, denominator: float) -> float:
        return self._round((numerator / max(1, denominator)) * 100)

    def _average(self, values) -> float:
        values = list(values)
        return sum(values) / len(values) if values else 0.0

    def _minutes_between(self, start: float | None, end: float | None) -> float:
        return (end - start) / 60_000 if start is not None and end is not None and end >= start else 0.0

    def _observable_minutes(self, events: list[dict]) -> int:
        return len({int(event["time"] // (3 * 60_000)) for event in events if event["time"] is not None and event["type"] in ACTION_EVENTS}) * 3

    def _cap(self, value: float | None, full_score_at: float) -> float:
        if value is None:
            return 0.0
        return max(0.0, min(100.0, (value / max(1, full_score_at)) * 100))

    def _band(self, value: float | None, low: float, high: float) -> float:
        if value is None:
            return 0.0
        if value < low:
            return max(0.0, (value / max(low, 0.1)) * 70)
        if value <= high:
            return 100.0
        return max(0.0, 100 - ((value - high) / max(high, 1)) * 60)

    def _inverse_percent(self, value: float | None, zero_at: float) -> float:
        if value is None:
            return 50.0
        return max(0.0, min(100.0, 100 - (value / max(1, zero_at)) * 100))

    def _inverse_band(self, value: float, full_at: float, zero_at: float) -> float:
        if value <= full_at:
            return 100.0
        if value >= zero_at:
            return 0.0
        return 100.0 * (zero_at - value) / (zero_at - full_at)

    def _median(self, values: list[float]) -> float | None:
        if not values:
            return None
        ordered = sorted(values)
        count = len(ordered)
        middle = count // 2
        if count % 2 == 1:
            return self._round(ordered[middle])
        return self._round((ordered[middle - 1] + ordered[middle]) / 2)

    def _percentile(self, values: list[float], percentile: float) -> float | None:
        if not values:
            return None
        ordered = sorted(values)
        if len(ordered) == 1:
            return self._round(ordered[0])
        position = (len(ordered) - 1) * percentile / 100
        lower = int(position)
        upper = min(lower + 1, len(ordered) - 1)
        if lower == upper:
            return self._round(ordered[lower])
        weight = position - lower
        return self._round(ordered[lower] * (1 - weight) + ordered[upper] * weight)

    def _level(self, score: float) -> str:
        if score >= 85:
            return "muy alta"
        if score >= 65:
            return "alta"
        if score >= 40:
            return "media"
        if score >= 15:
            return "baja"
        return "insuficiente"

    def _atom(
        self,
        id: str,
        name: str,
        value,
        unit: str | None,
        detail: str,
        interpretation: str,
        reliability: str,
        scored: bool,
    ) -> dict:
        # Version enriquecida de un atomo (id/nombre/valor + de donde sale y
        # que significa), en el mismo espiritu que `_metric`/`_group` en
        # submission_review.py (v1) y que `atomicMetric` en el motor TS
        # equivalente `AgencyMetricsServiceV2.ts`. `scored` indica si el
        # atomo puntua el promedio de su indice/sub-dimension o si es solo
        # contexto/flag (ver secciones 2.1-2.4 de metrics-new-approach.md).
        return {
            "id": id,
            "name": name,
            "value": value,
            "unit": unit,
            "detail": detail,
            "interpretation": interpretation,
            "reliability": reliability,
            "scored": scored,
        }

    # ------------------------------------------------------------------
    # Trazabilidad (T1-T9)
    # ------------------------------------------------------------------
    def _traceability(self, context: dict, events: list[dict], atoms: dict) -> dict:
        file_changes = context["file_changes"]
        saves = context["saves"]
        starts = context["starts"]
        finishes = context["finishes"]
        exports = context["exports"]
        files_changed = context["files_changed"]
        files_saved = context["files_saved"]

        saved_touched = len([file for file in files_changed if file in files_saved])
        t1 = self._percent(saved_touched, len(files_changed)) if files_changed else 0.0
        tasks_started = len(starts)
        tasks_finished = len(finishes)
        t2 = self._percent(tasks_finished, tasks_started) if tasks_started else 0.0
        exports_count = len(exports)
        t3 = 100.0 if exports_count > 0 else 0.0
        total_events = len(events)
        t4_ratio = max(0.0, min(1.0, 1 - (context["hash_discontinuities"] / max(1, total_events))))
        t4 = self._round(t4_ratio * 100)
        t5_ratio = self._sequence_score(context["sorted_views"])
        t5 = self._round(t5_ratio * 100)

        changes_after_export = self._after_last(
            exports,
            [view for view in context["work_file_views"] if view["type"] in {"file_changed", "file_saved", "file_created"}],
        )
        restorations = context["restorations_count"]
        protected_sequences = context["protected_sequences"]
        temporal_gaps = context["temporal_gaps"]

        atoms.update(
            {
                "T1": t1,
                "T2": t2,
                "T3": t3,
                "T4": t4,
                "T5": t5,
                "T6": changes_after_export,
                "T7": restorations,
                "T8": len(protected_sequences),
                "T9": temporal_gaps,
            }
        )

        score = round(self._average([t1, t2, t3, t4, t5]))
        if t4 == 100 and exports_count > 0:
            confidence = "alta"
        elif tasks_started == 0 or exports_count == 0:
            confidence = "limitada"
        else:
            confidence = "media"

        flags = []
        if changes_after_export > 0:
            flags.append(f"Hay {changes_after_export} cambio(s) despues del ultimo envio")
        if restorations > 0:
            flags.append(f"Hay {restorations} restauracion(es) automatica(s) del sistema")
        if protected_sequences:
            flags.append(f"Hay {len(protected_sequences)} secuencia(s) sospechosa(s) en archivos protegidos")
        if temporal_gaps > 0:
            flags.append(f"Hay {temporal_gaps} discontinuidad(es) temporal(es) grande(s) (pausas >= 15 min)")

        return {"score": max(0, min(100, score)), "confidence": confidence, "flags": flags}

    def _sequence_score(self, sorted_views: list[dict]) -> float:
        changed = next((view["time"] for view in sorted_views if view["type"] == "file_changed"), None)
        saved = next((view["time"] for view in sorted_views if view["type"] == "file_saved" and changed is not None and view["time"] >= changed), None)
        finished = next((view["time"] for view in sorted_views if view["type"] in {"task_finished", "task_completed"} and saved is not None and view["time"] >= saved), None)
        exported = next((view["time"] for view in sorted_views if view["type"] == "submission_exported" and finished is not None and view["time"] >= finished), None)
        hits = len([value for value in [changed, saved, finished, exported] if value is not None])
        return hits / 4

    def _after_last(self, exports: list[dict], events: list[dict]) -> int:
        last_export = exports[-1]["time"] if exports else None
        return 0 if last_export is None else len([event for event in events if event["time"] is not None and event["time"] > last_export])

    # ------------------------------------------------------------------
    # Compromiso / Proceso (C1-C35)
    # ------------------------------------------------------------------
    def _engagement(self, context: dict, manifest: dict, atoms: dict) -> dict:
        saves = context["saves"]
        file_changes = context["file_changes"]
        effective_changes = context["effective_changes"]
        created = context["created"]
        deleted = context["deleted"]
        files_changed = context["files_changed"]
        expected = context["expected"]
        starts = context["starts"]
        finishes = context["finishes"]
        task_durations = context["task_durations"]
        observable_minutes = context["observable_minutes"]
        session_minutes = context["session_minutes"]
        outside_src = context["outside_src"]
        temporal_gaps = context["temporal_gaps"]
        actions = context["actions"]
        views = context["views"]
        work_file_views = context["work_file_views"]

        # -- Presencia (informativo: C1, C5; puntuable: C2, C3, C4) --
        c1 = self._round(session_minutes)
        c2_raw = self._round(sum(item["minutes"] for item in task_durations))
        c2 = self._cap(c2_raw, C2_FULL_SCORE_MINUTES)
        c3_raw = self._round(observable_minutes)
        c3 = self._cap(c3_raw, C3_FULL_SCORE_MINUTES)
        c4_raw = self._ratio(len(actions), max(1, observable_minutes))
        c4 = self._cap(c4_raw, C4_FULL_SCORE_RATIO)
        c5 = temporal_gaps
        presencia = self._round(self._average([c2, c3, c4]))

        # -- Intensidad de edicion (C6-C11) --
        c6_raw = self._ratio(len(file_changes), max(1, observable_minutes))
        c6 = self._band(c6_raw, *C6_DENSITY_BAND)
        c7 = self._percent(len(effective_changes), len(file_changes)) if file_changes else 0.0
        c8_raw = sum(event["changeCount"] for event in file_changes)
        c8 = self._cap(c8_raw, C8_FULL_SCORE_VOLUME)
        c9_raw = sum(event["lineCount"] for event in file_changes)
        c9 = self._cap(c9_raw, C9_FULL_SCORE_LINES)
        line_visits = self._line_visit_counts(file_changes)
        c10_raw = len(line_visits)
        c10 = self._cap(c10_raw, C10_FULL_SCORE_UNIQUE_LINES)
        dispersions = self._line_dispersions(file_changes)
        c11_raw = self._round(self._average(dispersions)) if dispersions else 0.0
        c11 = self._cap(c11_raw, C11_FULL_SCORE_DISPERSION)
        intensidad = self._round(self._average([c6, c7, c8, c9, c10, c11]))

        # -- Alineacion con tareas esperadas (C12-C14; C15 es flag aparte) --
        expected_touched = [file for file in expected if file in files_changed]
        c12 = self._percent(len(expected_touched), len(expected)) if expected else 55.0
        file_distribution = Counter(event["file"] or "-" for event in file_changes)
        top_file_count = max(file_distribution.values()) if file_distribution else 0
        c13_raw = self._percent(top_file_count, len(file_changes)) if file_changes else 0.0
        c13 = self._inverse_percent(c13_raw, C13_ZERO_AT_PERCENT)
        zones = self._functional_zones(file_changes)
        c14 = self._cap(len(zones), C14_FULL_SCORE_ZONES)
        alineacion = self._round(self._average([c12, c13, c14]))
        c15 = len(outside_src) + self._non_expected_events(work_file_views, expected)

        # -- Gestion de proceso (C16-C22) --
        saves_by_task = Counter(event["taskId"] or "outside task" for event in saves)
        c16_raw = self._round(self._average(saves_by_task.values())) if saves_by_task else 0.0
        c16 = self._cap(c16_raw, C16_FULL_SCORE_SAVES_PER_TASK)
        c17_raw = self._ratio(len(effective_changes), len(saves))
        c17 = self._band(c17_raw, *C17_BAND)
        c18_raw = self._first_latency(starts, file_changes)
        c18 = self._inverse_percent(c18_raw, C18_ZERO_AT_MINUTES) if starts else 50.0
        c19_raw = self._first_latency(starts, saves)
        c19 = self._inverse_percent(c19_raw, C19_ZERO_AT_MINUTES) if starts else 50.0
        c20 = self._round(self._task_time_evenness(task_durations))
        task_ids_started = {item["taskId"] for item in starts if item["taskId"]}
        actions_by_task = Counter(action["taskId"] for action in actions if action["taskId"])
        tasks_with_activity = len([task_id for task_id in task_ids_started if actions_by_task.get(task_id, 0) > 0])
        c21 = self._percent(tasks_with_activity, len(task_ids_started)) if task_ids_started else (100.0 if actions else 0.0)
        off_task, total_scoped = self._off_task_after_start(views, starts)
        c22_raw = self._percent(off_task, total_scoped) if total_scoped else 0.0
        c22 = self._inverse_percent(c22_raw, C22_ZERO_AT_PERCENT)
        gestion_proceso = self._round(self._average([c16, c17, c18, c19, c20, c21, c22]))

        # -- Validacion (C26-C27) --
        c26_raw = len([event for event in work_file_views if event["file"] and TEST_PATTERN.search(event["file"]) and event["type"] in ACTION_EVENTS])
        c26 = self._cap(c26_raw, C26_FULL_SCORE_COUNT)
        c27_raw = len([event for event in views if event["taskId"] and TEST_TASK_PATTERN.search(event["taskId"]) and event["type"] in ACTION_EVENTS])
        c27 = self._cap(c27_raw, C27_FULL_SCORE_COUNT)
        validacion = self._round(self._average([c26, c27]))

        subdimensions = {
            "presencia": presencia,
            "intensidad": intensidad,
            "alineacion": alineacion,
            "gestionProceso": gestion_proceso,
            "validacion": validacion,
        }
        score = round(
            presencia * ENGAGEMENT_SUBDIM_WEIGHTS["presencia"]
            + intensidad * ENGAGEMENT_SUBDIM_WEIGHTS["intensidad"]
            + alineacion * ENGAGEMENT_SUBDIM_WEIGHTS["alineacion"]
            + gestion_proceso * ENGAGEMENT_SUBDIM_WEIGHTS["gestionProceso"]
            + validacion * ENGAGEMENT_SUBDIM_WEIGHTS["validacion"]
        )

        # -- Patrones de edicion y exploracion: solo contexto/flags --
        massive_changes = [event for event in file_changes if event["lineCount"] > 20 or event["changeCount"] > 20]
        c28 = len(massive_changes)
        c29 = self._incremental_index_by_blocks(file_changes)
        window_avg, window_max = self._window_stats(file_changes)
        pause_median = self._median(context["active_pauses"]) or 0.0
        c32 = len(created)
        variant_created = [event for event in created if event["file"] and VARIANT_PATTERN.search(event["file"])]
        c33 = len(variant_created)
        c34 = len(deleted)
        c35 = self._changes_after_task_finish(file_changes, finishes)

        atoms.update(
            {
                "C1": c1,
                "C2": c2,
                "C3": c3,
                "C4": c4,
                "C5": c5,
                "C6": c6,
                "C7": c7,
                "C8": c8,
                "C9": c9,
                "C10": c10,
                "C11": c11,
                "C12": c12,
                "C13": c13,
                "C14": c14,
                "C15": c15,
                "C16": c16,
                "C17": c17,
                "C18": c18,
                "C19": c19,
                "C20": c20,
                "C21": c21,
                "C22": c22,
                "C26": c26,
                "C27": c27,
                "C28": c28,
                "C29": c29,
                "C30": window_avg,
                "C31": pause_median,
                "C32": c32,
                "C33": c33,
                "C34": c34,
                "C35": c35,
            }
        )

        flags = []
        if c15 > 0:
            flags.append(f"Hay {c15} accion(es) fuera de src o no esperadas por el manifest de la actividad")
        if c28 > 0:
            top = max(massive_changes, key=lambda event: max(event["lineCount"], event["changeCount"]))
            top_size = max(top["lineCount"], top["changeCount"])
            flags.append(f"{c28} cambio(s) subito(s) de hasta {top_size} lineas en {top['file'] or 'archivo desconocido'} (revisar contexto)")
        if c33 > 0:
            flags.append(f"Se crearon {c33} archivo(s) con nombre de variante o copia (revisar)")
        if c35 > 0:
            flags.append(f"Hay {c35} cambio(s) despues del cierre de una tarea")
        if temporal_gaps > 0:
            flags.append(f"Hay {temporal_gaps} discontinuidad(es) temporal(es) grande(s) (pausas >= 15 min); interpretar Compromiso con cautela")

        confidence = self._engagement_confidence(bool(starts), bool(expected))

        return {
            "score": max(0, min(100, score)),
            "confidence": confidence,
            "subdimensions": {key: round(value) for key, value in subdimensions.items()},
            "flags": flags,
        }

    def _engagement_confidence(self, has_starts: bool, has_expected: bool) -> str:
        # Aproxima "proporcion de sub-dimensiones cuyas metricas son
        # mayoritariamente direct" (seccion 5.2) con una tabla fija de
        # fiabilidad por metrica (documentada aqui, no en el spec, que no
        # detalla la fiabilidad metrica a metrica).
        block_reliabilities = {
            "presencia": ["estimated", "estimated", "direct"],  # C2, C3, C4
            "intensidad": ["estimated", "direct", "direct", "direct", "direct", "estimated"],  # C6-C11
            "alineacion": ["direct" if has_expected else "limited", "direct", "limited"],  # C12-C14
            "gestionProceso": [
                "direct",
                "direct",
                "direct" if has_starts else "limited",
                "direct" if has_starts else "limited",
                "estimated",
                "direct",
                "direct",
            ],  # C16-C22
            "validacion": ["estimated", "estimated"],  # C26, C27
        }
        majority_direct_blocks = 0
        for tags in block_reliabilities.values():
            direct_count = sum(1 for tag in tags if tag == "direct")
            if direct_count > len(tags) / 2:
                majority_direct_blocks += 1
        ratio = majority_direct_blocks / len(block_reliabilities)
        if ratio >= 0.8:
            return "alta"
        if ratio >= 0.4:
            return "media"
        return "limitada"

    def _line_visit_counts(self, file_changes: list[dict]) -> Counter:
        visits = Counter()
        for event in file_changes:
            if not event["file"]:
                continue
            for line in event["lines"]:
                visits[f"{event['file']}:{line}"] += 1
        return visits

    def _line_dispersions(self, file_changes: list[dict]) -> list[float]:
        by_file: dict[str, list[int]] = defaultdict(list)
        for event in file_changes:
            if event["file"] and event["lines"]:
                by_file[event["file"]].extend(event["lines"])
        return [max(lines) - min(lines) + 1 for lines in by_file.values() if lines]

    def _functional_zones(self, file_changes: list[dict]) -> set:
        zones = set()
        for event in file_changes:
            if not event["file"]:
                continue
            for line in event["lines"]:
                zones.add(f"{event['file']}#{line // 50}")
        return zones

    def _non_expected_events(self, events: list[dict], expected: set) -> int:
        if not expected:
            return 0
        return len([event for event in events if event["file"] and event["type"] in ACTION_EVENTS and event["file"] not in expected])

    def _first_latency(self, starts: list[dict], targets: list[dict]) -> float | None:
        ordered_targets = sorted([target for target in targets if target["time"] is not None], key=lambda target: target["time"])
        latencies = []
        for start in starts:
            if start["time"] is None:
                continue
            target = next(
                (
                    candidate
                    for candidate in ordered_targets
                    if candidate["time"] >= start["time"] and (not start["taskId"] or not candidate["taskId"] or candidate["taskId"] == start["taskId"])
                ),
                None,
            )
            if target:
                latencies.append(self._minutes_between(start["time"], target["time"]))
        return min(latencies) if latencies else None

    def _task_time_evenness(self, task_durations: list[dict]) -> float:
        minutes = [item["minutes"] for item in task_durations if item["minutes"] > 0]
        if len(minutes) <= 1:
            return 100.0
        mean = sum(minutes) / len(minutes)
        if mean <= 0:
            return 100.0
        variance = sum((value - mean) ** 2 for value in minutes) / len(minutes)
        coefficient_of_variation = (variance ** 0.5) / mean
        return max(0.0, min(100.0, 100.0 * (1 - coefficient_of_variation)))

    def _off_task_after_start(self, views: list[dict], starts: list[dict]) -> tuple[int, int]:
        if not starts:
            return 0, 0
        first_start = min(item["time"] for item in starts)
        scoped = [view for view in views if view["time"] is not None and view["time"] >= first_start and view["type"] != "heartbeat"]
        off_task = len([view for view in scoped if not view["taskId"]])
        return off_task, len(scoped)

    def _incremental_index_by_blocks(self, file_changes: list[dict]) -> float:
        # C29 redefinido (seccion 2.2): agrega file_changed efectivos en
        # bloques de actividad continua separados por >=30s de inactividad,
        # y mide que proporcion de esos BLOQUES corresponde en conjunto a un
        # cambio pequeno (<=3 lineas acumuladas), en vez de mirar el evento
        # crudo como hacia la version anterior (metric 33).
        ordered = sorted(
            [event for event in file_changes if event["time"] is not None and (event["changeCount"] > 0 or event["lineCount"] > 0)],
            key=lambda event: event["time"],
        )
        if not ordered:
            return 0.0
        blocks = [[ordered[0]]]
        for event in ordered[1:]:
            if event["time"] - blocks[-1][-1]["time"] >= C29_BLOCK_GAP_MS:
                blocks.append([event])
            else:
                blocks[-1].append(event)
        small_blocks = len([block for block in blocks if sum(event["lineCount"] for event in block) <= C29_SMALL_BLOCK_LINES])
        return self._percent(small_blocks, len(blocks))

    def _window_stats(self, file_changes: list[dict]) -> tuple[float, int]:
        windows: Counter = Counter()
        for event in file_changes:
            if event["time"] is not None:
                windows[int(event["time"] // 60_000)] += 1
        values = list(windows.values())
        if not values:
            return 0.0, 0
        return self._round(self._average(values)), max(values)

    def _changes_after_task_finish(self, file_changes: list[dict], finishes: list[dict]) -> int:
        return len(
            [
                event
                for event in file_changes
                if any(finish["taskId"] == event["taskId"] and event["time"] is not None and finish["time"] is not None and event["time"] > finish["time"] for finish in finishes)
            ]
        )

    # ------------------------------------------------------------------
    # Autoria (A1-A10)
    # ------------------------------------------------------------------
    def _authorship(self, context: dict, atoms: dict) -> dict:
        file_changes = context["file_changes"]

        def unit_size(event: dict) -> float:
            return event["lineCount"] if event["lineCount"] > 0 else event["changeCount"]

        total_units = sum(unit_size(event) for event in file_changes)
        small_units = sum(unit_size(event) for event in file_changes if event["changeCount"] <= A1_SMALL_EVENT_MAX_LINES)
        a1 = self._percent(small_units, total_units) if total_units else 0.0

        sized_events = [(unit_size(event), event) for event in file_changes if unit_size(event) > 0]
        max_size, max_event = max(sized_events, key=lambda item: item[0]) if sized_events else (0, None)
        a2 = self._inverse_band(max_size, A2_FULL_SCORE_MAX_LINES, A2_ZERO_SCORE_MAX_LINES)

        gaps_by_file = self._small_event_gaps_by_file(file_changes)
        all_gaps = [gap for gaps in gaps_by_file.values() for gap in gaps]
        in_range = [gap for gap in all_gaps if A3_MIN_GAP_MS <= gap[0] <= A3_MAX_GAP_MS]
        a3 = self._percent(len(in_range), len(all_gaps)) if all_gaps else 50.0

        file_growth_correlations = self._file_growth_correlations(file_changes, unit_size)
        a4 = self._round(self._average(file_growth_correlations) * 100) if file_growth_correlations else 50.0

        line_visits = self._line_visit_counts(file_changes)
        unique_lines = len(line_visits)
        line_repeats = len([count for count in line_visits.values() if count > 1])
        a5 = self._percent(line_repeats, unique_lines) if unique_lines else 0.0

        refinement_blocks = self._refinement_blocks(file_changes)
        a6_raw = max(refinement_blocks.values()) if refinement_blocks else 0
        a6 = self._cap(a6_raw, A6_FULL_SCORE_BLOCKS)

        a7 = self._read_edit_cycles(context["views"])
        a8 = len(context["files_consulted"])
        a9 = self._ratio(len(context["files_consulted"]), len(context["files_changed"]))
        a10 = self._reopen_modified_files(context["views"])

        atoms.update(
            {
                "A1": a1,
                "A2": a2,
                "A3": a3,
                "A4": a4,
                "A5": a5,
                "A6": a6,
                "A7": a7,
                "A8": a8,
                "A9": a9,
                "A10": a10,
            }
        )

        score = round(
            a1 * AUTHORSHIP_WEIGHTS["A1"]
            + a2 * AUTHORSHIP_WEIGHTS["A2"]
            + a3 * AUTHORSHIP_WEIGHTS["A3"]
            + a4 * AUTHORSHIP_WEIGHTS["A4"]
            + a5 * AUTHORSHIP_WEIGHTS["A5"]
            + a6 * AUTHORSHIP_WEIGHTS["A6"]
        )

        flags = []
        if max_event and max_size > A2_FULL_SCORE_MAX_LINES:
            flags.append(
                f"Evento unico de {int(max_size)} lineas en {max_event['file'] or 'archivo desconocido'} a las {self._timestamp_label(max_event['time'])} (metrica A2)"
            )
        flags.extend(self._uniformity_flags(gaps_by_file))

        distinct_files = len({event["file"] for event in file_changes if event["file"]})
        if len(file_changes) >= 30 and distinct_files >= 2:
            confidence = "alta"
        elif len(file_changes) >= 10:
            confidence = "media"
        else:
            confidence = "limitada"
            flags.append("Muestra de eventos de edicion insuficiente para estimar tecleo con confianza")

        return {
            "score": max(0, min(100, score)),
            "confidence": confidence,
            "note": "Estimado a partir de metadatos de edicion (tamano/ritmo de evento), ciego a la conversacion con el agente",
            "flags": flags,
        }

    def _small_event_gaps_by_file(self, file_changes: list[dict]) -> dict[str, list[tuple[float, dict, dict]]]:
        by_file: dict[str, list[dict]] = defaultdict(list)
        for event in file_changes:
            if event["time"] is not None and event["changeCount"] <= A1_SMALL_EVENT_MAX_LINES:
                by_file[event["file"] or "-"].append(event)
        gaps: dict[str, list[tuple[float, dict, dict]]] = {}
        for file, file_events in by_file.items():
            ordered = sorted(file_events, key=lambda event: event["time"])
            gaps[file] = [(ordered[index]["time"] - ordered[index - 1]["time"], ordered[index - 1], ordered[index]) for index in range(1, len(ordered))]
        return gaps

    def _uniformity_flags(self, gaps_by_file: dict[str, list[tuple[float, dict, dict]]]) -> list[str]:
        flags = []
        for file, gaps in gaps_by_file.items():
            if not gaps:
                continue
            burst: list[tuple[float, dict, dict]] = []
            bursts: list[list[tuple[float, dict, dict]]] = []
            for gap in gaps:
                if gap[0] <= A3_MAX_GAP_MS:
                    burst.append(gap)
                else:
                    if burst:
                        bursts.append(burst)
                    burst = []
            if burst:
                bursts.append(burst)
            for burst_gaps in bursts:
                if len(burst_gaps) + 1 < UNIFORMITY_MIN_BURST_EVENTS:
                    continue
                values = [gap[0] for gap in burst_gaps]
                mean = sum(values) / len(values)
                if mean <= 0:
                    continue
                variance = sum((value - mean) ** 2 for value in values) / len(values)
                coefficient_of_variation = (variance ** 0.5) / mean
                if coefficient_of_variation < UNIFORMITY_CV_THRESHOLD:
                    start_label = self._timestamp_label(burst_gaps[0][1]["time"])
                    end_label = self._timestamp_label(burst_gaps[-1][2]["time"])
                    flags.append(
                        f"Ritmo de tecleo inusualmente regular en {file} entre {start_label} y {end_label}, revisar si es pegado fragmentado para simular tecleo"
                    )
        return flags

    def _file_growth_correlations(self, file_changes: list[dict], unit_size) -> list[float]:
        by_file: dict[str, list[dict]] = defaultdict(list)
        for event in file_changes:
            if event["file"] and event["time"] is not None:
                by_file[event["file"]].append(event)
        correlations = []
        for events in by_file.values():
            if len(events) < 3:
                continue
            ordered = sorted(events, key=lambda event: event["time"])
            index_sequence = list(range(len(ordered)))
            cumulative = 0.0
            cumulative_sequence = []
            for event in ordered:
                cumulative += unit_size(event)
                cumulative_sequence.append(cumulative)
            correlation = self._pearson(index_sequence, cumulative_sequence)
            if correlation is not None:
                correlations.append(max(0.0, min(1.0, correlation)))
        return correlations

    def _pearson(self, xs: list[float], ys: list[float]) -> float | None:
        count = len(xs)
        if count < 2:
            return None
        mean_x = sum(xs) / count
        mean_y = sum(ys) / count
        covariance = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
        variance_x = sum((x - mean_x) ** 2 for x in xs)
        variance_y = sum((y - mean_y) ** 2 for y in ys)
        if variance_x <= 0 or variance_y <= 0:
            return None
        return covariance / ((variance_x ** 0.5) * (variance_y ** 0.5))

    def _refinement_blocks(self, file_changes: list[dict]) -> dict[str, int]:
        by_file: dict[str, list[dict]] = defaultdict(list)
        for event in file_changes:
            if event["file"] and event["time"] is not None:
                by_file[event["file"]].append(event)
        blocks = {}
        for file, events in by_file.items():
            ordered = sorted(events, key=lambda event: event["time"])
            count = 1 if ordered else 0
            for index in range(1, len(ordered)):
                if ordered[index]["time"] - ordered[index - 1]["time"] > A6_REFINEMENT_GAP_MS:
                    count += 1
            blocks[file] = count
        return blocks

    def _read_edit_cycles(self, views: list[dict]) -> int:
        count = 0
        for index, view in enumerate(views):
            if view["type"] != "active_editor_changed" or not view["file"] or view["time"] is None:
                continue
            edit = next(
                (candidate for candidate in views[index + 1 :] if candidate["type"] == "file_changed" and candidate["file"] == view["file"] and candidate["time"] is not None),
                None,
            )
            if edit and edit["time"] - view["time"] <= A7_READ_EDIT_WINDOW_MS:
                count += 1
        return count

    def _reopen_modified_files(self, views: list[dict]) -> int:
        modified: set = set()
        current_file = None
        count = 0
        for view in views:
            if view["type"] == "file_changed" and view["file"]:
                modified.add(view["file"])
            if view["type"] == "active_editor_changed" and view["file"]:
                if view["file"] in modified and current_file and current_file != view["file"]:
                    count += 1
                current_file = view["file"]
        return count

    # ------------------------------------------------------------------
    # Soporte de Agentes (S1-S3; S4 fase 2 omitido)
    # ------------------------------------------------------------------
    def _agent_support(self, context: dict, interactions: list[dict], atoms: dict) -> dict:
        file_changes = context["file_changes"]

        if not interactions:
            atoms.update({"S1": 0.0, "S2": None, "S3": 0.0})
            return {
                "score": 0,
                "confidence": "limitada",
                "note": "No hay registro de conversacion con el agente para esta entrega; no se puede estimar el soporte recibido.",
                "flags": [],
            }

        groups: dict[str, dict[str, int]] = defaultdict(lambda: {"student": 0, "agent": 0})
        for item in interactions:
            key = item["taskId"] or "sin-tarea"
            actor_key = "agent" if item["actor"] == "agent" else "student"
            groups[key][actor_key] += len(item["message"])
        ratios = []
        for counts in groups.values():
            total = counts["student"] + counts["agent"]
            if total > 0:
                ratios.append(counts["student"] / total)
        s1 = self._round(self._average(ratios) * 100) if ratios else 0.0

        agent_messages = [item for item in interactions if item["actor"] == "agent"]
        total_considered = len(file_changes)
        matched = 0
        for event in file_changes:
            if not event["taskId"] or event["time"] is None:
                continue
            window_start = event["time"] - S3_WINDOW_MS
            if any(message["taskId"] == event["taskId"] and window_start <= message["time"] < event["time"] for message in agent_messages):
                matched += 1
        s3 = self._percent(matched, total_considered) if total_considered else 0.0

        latencies = []
        for message in agent_messages:
            if not message["taskId"]:
                continue
            candidates = sorted(
                [event for event in file_changes if event["taskId"] == message["taskId"] and event["time"] is not None and event["time"] >= message["time"]],
                key=lambda event: event["time"],
            )
            if candidates:
                latencies.append(self._minutes_between(message["time"], candidates[0]["time"]))
        s2 = self._median(latencies)

        atoms.update({"S1": s1, "S2": s2, "S3": s3})

        score = round(s3 * AGENT_SUPPORT_WEIGHTS["S3"] + s1 * AGENT_SUPPORT_WEIGHTS["S1"])
        count = len(interactions)
        note = None
        if count < 10:
            confidence = "limitada"
            note = f"Solo {count} interaccion{'es' if count != 1 else ''} con el agente registrada{'s' if count != 1 else ''}; interpretar con cautela."
        elif count < 25:
            confidence = "media"
        else:
            confidence = "alta"

        result = {"score": max(0, min(100, score)), "confidence": confidence, "flags": []}
        if note:
            result["note"] = note
        return result

    # ------------------------------------------------------------------
    # Matriz de interpretacion cruzada + resumen ejecutivo (secciones 5.5/6)
    # ------------------------------------------------------------------
    def _interpretation_flag(self, authorship_score: float, agent_support_score: float, has_agent_data: bool) -> str | None:
        if authorship_score >= AUTHORSHIP_LOW_THRESHOLD:
            return None
        if has_agent_data and agent_support_score >= AGENT_SUPPORT_HIGH_THRESHOLD:
            return (
                f"Autoria baja ({authorship_score}) junto con Soporte de Agentes alto ({agent_support_score}): "
                "los eventos de pegado detectados coinciden con interaccion de agente reciente -- sospecha de copia literal, revisar"
            )
        support_label = str(agent_support_score) if has_agent_data else "sin datos"
        return (
            f"Autoria baja ({authorship_score}) junto con Soporte de Agentes bajo ({support_label}): "
            "contenido llegado sin tecleo y sin registro de conversacion con el agente -- posible pegado de una fuente no registrada "
            "(otro archivo, internet, IA externa), revisar igual"
        )

    def _summary(self, traceability: dict, engagement: dict, authorship: dict, agent_support: dict) -> dict:
        score = round(
            traceability["score"] * SUMMARY_WEIGHTS["traceability"]
            + engagement["score"] * SUMMARY_WEIGHTS["engagement"]
            + authorship["score"] * SUMMARY_WEIGHTS["authorship"]
            + agent_support["score"] * SUMMARY_WEIGHTS["agentSupport"]
        )
        score = max(0, min(100, score))
        flags = []
        if traceability["score"] < TRACEABILITY_SUBORDINATION_THRESHOLD:
            flags.append("Trazabilidad insuficiente: los demas indices deben leerse con cautela")
        return {"score": score, "level": self._level(score), "flags": flags}
