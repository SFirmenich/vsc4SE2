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
from core.services.evidence_crypto import decrypt_events, read_private_key_from_activity
from core.services.event_receipts import public_key_fingerprint, verify_payload_signature


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
    re.compile(r"(^|/)(state|events|agent-interactions|agent-evidence|agent-evidence-state|current-task)\.jsonl?$", re.I),
    re.compile(r"(^|/)AGENTS\.generated\.md$", re.I),
]
TEST_PATTERN = re.compile(r"(^|/)(tests?|__tests__)/|(\.test|\.spec)\.[^./]+$|(^|/)test_[^/]+\.py$", re.I)
TEST_TASK_PATTERN = re.compile(r"(test|prueba|testing|validacion|validation)", re.I)
PROTECTED_EDIT_WINDOW_MS = 10 * 60 * 1000


class SubmissionReviewService:
    def build(self, submission: Submission) -> dict:
        with zipfile.ZipFile(submission.original_zip.path) as zf:
            validate_zip(zf)
            name_map = build_name_map(zf)
            parsed = self._read_review_inputs(zf, name_map, submission.contribution_id)

        private_key = read_private_key_from_activity(submission.activity_version)
        events, decrypt_warnings = decrypt_events(parsed["events"], private_key)
        parsed["event_invalid_lines"].extend(
            {"line": item.get("details", {}).get("line"), "reason": item["message"]}
            for item in decrypt_warnings
        )
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
            "externalIntegrity": self._external_integrity(events, parsed["activity_manifest"]),
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
            work_file = bool(file and self._is_work_source_file(file))
            if work_file:
                files.add(file)
            timestamp = self._timestamp(event.get("timestamp"))
            if timestamp is not None:
                hour = datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).strftime("%H")
                activity_by_hour[hour] += 1
            if self._event_type(event) == "file_changed" and work_file:
                file_change_events += 1
                if timestamp is not None and (previous_edit is None or timestamp - previous_edit > 120_000):
                    edit_bursts += 1
                previous_edit = timestamp
            if not work_file:
                continue
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
        source_files = list(files)
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
        work_views = [event for event in views if not event["file"] or self._is_work_source_file(event["file"])]
        work_file_views = [event for event in views if event["file"] and self._is_work_source_file(event["file"])]
        heartbeat = self._count(views, "heartbeat")
        actions = [event for event in work_views if event["type"] in ACTION_EVENTS]
        file_changes = self._by_type(work_file_views, "file_changed")
        effective_changes = [event for event in file_changes if event["changeCount"] > 0 or event["lineCount"] > 0]
        saves = self._by_type(work_file_views, "file_saved")
        created = self._by_type(work_file_views, "file_created")
        deleted = self._by_type(work_file_views, "file_deleted")
        exports = [event for event in self._by_type(views, "submission_exported") if event["time"] is not None]
        starts = [event for event in views if event["type"] == "task_started" and event["taskId"] and event["time"] is not None]
        finishes = [event for event in views if event["type"] in {"task_finished", "task_completed"} and event["taskId"] and event["time"] is not None]
        files_changed = {event["file"] for event in file_changes if event["file"]}
        files_saved = {event["file"] for event in saves if event["file"]}
        files_consulted = {event["file"] for event in self._by_type(work_file_views, "active_editor_changed") if event["file"]}
        expected = {self._normalize_path(task.get("file")) for task in manifest.get("tasks", []) if isinstance(task, dict) and task.get("file") and self._is_work_source_file(task.get("file"))}
        protected_sequences = self._protected_edit_sequences(views)
        outside_src = [event for event in views if event["file"] and not self._is_work_source_file(event["file"]) and event["type"] in ACTION_EVENTS]
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
        changes_after_export = self._after_last(exports, [event for event in work_file_views if event["type"] in {"file_changed", "file_saved", "file_created"}])
        massive_changes = [event for event in file_changes if event["lineCount"] > 20 or event["changeCount"] > 20]
        incremental = [event for event in effective_changes if event["changeCount"] <= 1 and 0 < event["lineCount"] <= 3]
        systemic = [
            event
            for event in views
            if event["type"] == "heartbeat"
            or event["type"] == "agents_file_restored"
            or any(sequence["opened"] is event or sequence["change"] is event for sequence in protected_sequences)
            or (event["type"] == "file_changed" and event["changeCount"] == 0 and event["lineCount"] == 0)
        ]

        groups = [
            self._group(
                "Presencia y continuidad",
                [
                    self._metric(1, False, "Total session time", self._round(session_minutes), "min", "First event to last event.", "Raw log duration; it does not by itself equal effective work.", len(sorted_views), "direct"),
                    self._metric(2, True, "Active time inside tasks", self._round(sum(item["minutes"] for item in task_durations)), "min", self._task_duration_detail(task_durations), "Time between task start and finish, estimated if finish is missing.", len(task_durations), "estimated" if any(item["estimated"] for item in task_durations) else "direct"),
                    self._metric(3, True, "Time with observable activity", self._round(observable_minutes), "min", "Three-minute windows with at least one non-passive action.", "Filters periods with only heartbeat or passive presence.", len(actions), "estimated"),
                    self._metric(4, True, "Effective activity ratio", self._ratio(len(actions), heartbeat), None, "Observable actions divided by heartbeat.", "A high value suggests active interaction rather than passive presence.", len(actions), "direct"),
                ],
            ),
            self._group(
                "Editing intensity",
                [
                    self._metric(5, True, "Editing density in src", self._ratio(len(file_changes), observable_minutes), "changes/min", "file_changed events under src/ per observable minute.", "Extreme densities require contextual review.", len(file_changes), "estimated"),
                    self._metric(6, True, "Share of effective changes in src", self._percent(len(effective_changes), len(file_changes)), "%", "file_changed under src/ with changeCount or lines over total in src/.", "Distinguishes material changes from technical noise.", len(effective_changes), "direct"),
                    self._metric(7, True, "Total change volume in src", change_volume, None, "Sum of data.changeCount in file_changed under src/.", "Raw volume; interpret alongside lines and pace.", len(file_changes), "direct"),
                    self._metric(8, False, "Total affected lines in src", total_lines, None, "Sum of data.lines ranges under src/.", "Approximates textual scope, counting repetitions.", len(file_changes), "direct"),
                    self._metric(9, True, "Unique modified lines in src", unique_lines, None, "Distinct file:line entries under src/.", "Avoids counting repeated visits to the same line.", unique_lines, "direct"),
                ],
            ),
            self._group(
                "Intervention relevance",
                [
                    self._metric(11, False, "Editing concentration by file", self._percent(top_file_count, len(file_changes)), "%", "Percentage of changes in the dominant file.", "Shows whether effort is concentrated in one file.", len(file_changes), "direct"),
                    self._metric(12, True, "Expected file coverage", self._percent(len(expected_touched), len(expected)) if expected else "n/d", "%" if expected else None, f"{len(expected_touched)}/{len(expected)} task files modified." if expected else "The manifest does not declare task.file.", "Low coverage may indicate incompleteness or a valid alternative strategy.", len(expected_touched), "direct" if expected else "limited"),
                    self._metric(13, True, "Activity outside src or not expected", len(outside_src) + len(self._non_expected_events(work_file_views, expected)), None, "Actions on paths outside src/ or outside task.file when present.", "Contextual review indicator; it does not count as effective work.", len(outside_src), "estimated" if expected else "limited"),
                ],
            ),
            self._group(
                "Process management",
                [
                    self._metric(18, True, "Saves per task", self._round(self._average(Counter(event["taskId"] or "outside task" for event in saves).values())), None, "Average file_saved per task.", "Many saves may indicate incremental cycles; zero may depend on autosave.", len(saves), "direct"),
                    self._metric(19, True, "Changes per save ratio", self._ratio(len(effective_changes), len(saves)), None, "Effective file_changed divided by file_saved.", "Relates editing to persistence.", len(effective_changes) + len(saves), "direct"),
                    self._metric(25, False, "Explicit task completion", self._percent(len(finishes), len(starts)), "%", f"{len(finishes)}/{max(1, len(starts))} started tasks have a completion.", "Signal of pedagogical flow control.", len(starts) + len(finishes), "direct"),
                ],
            ),
            self._group(
                "Submission control",
                [
                    self._metric(23, False, "Number of submission exports", len(exports), None, "count(submission_exported).", "Multiple exports may indicate iteration or administrative testing.", len(exports), "direct"),
                    self._metric(30, True, "Changes after submission", changes_after_export, None, "Changes, saves, or creations after the last recorded export.", "May indicate that the latest workspace version does not match the exported submission.", changes_after_export, "direct" if exports else "limited"),
                    self._metric(50, False, "Submission traceability index", self._percent(self._traceability_score(len(files_changed), len([file for file in files_changed if file in files_saved]), len(starts), len(finishes), len(exports), hash_discontinuities), 1), "%", "Combines changed files, saves, completions, exports, and hash integrity.", "Summarizes how explainable the final submission is from the log.", len(events), "estimated"),
                ],
            ),
            self._group(
                "Editing patterns",
                [
                    self._metric(32, False, "Sudden massive changes", len(massive_changes), None, "file_changed with more than 20 lines or changeCount greater than 20.", "Signal to review paste, formatting, generation, or broad replacements.", len(massive_changes), "estimated"),
                    self._metric(33, False, "Incremental editing index", self._percent(len(incremental), len(effective_changes)), "%", "Small changes over effective changes.", "Compatible with step-by-step construction when high.", len(incremental), "estimated"),
                    self._metric(35, False, "Pauses between active actions", self._pause_detail(self._pauses([event for event in sorted_views if event["type"] != "heartbeat"])), None, "Differences between non-heartbeat actions.", "Pauses may be reading, consultation, blockage, or external work.", len(actions), "direct"),
                ],
            ),
            self._group(
                "Exploracion y lectura",
                [
                    self._metric(37, True, "Number of consulted files", len(files_consulted), None, "Distinct files in active_editor_changed.", "Measures breadth of project exploration.", len(files_consulted), "direct"),
                    self._metric(38, False, "Consulted-to-modified files ratio", self._ratio(len(files_consulted), len(files_changed)), None, "Consulted files divided by modified files.", "High values suggest context search or dispersed exploration.", len(files_consulted) + len(files_changed), "direct"),
                ],
            ),
            self._group(
                "Validation and testing",
                [
                    self._metric(43, False, "Activity on tests in src", len([event for event in work_file_views if event["file"] and TEST_PATTERN.search(event["file"]) and event["type"] in ACTION_EVENTS]), None, "Actions under src/ on test paths or *.test/*.spec/test_*.py files.", "Indicates work aimed at checking the solution when applicable.", len(work_file_views), "estimated"),
                    self._metric(44, False, "Activity associated with a testing task", len([event for event in views if event["taskId"] and TEST_TASK_PATTERN.search(event["taskId"]) and event["type"] in ACTION_EVENTS]), None, "Actions in taskId related to testing or validation.", "Measures visible activity in verification tasks.", len(views), "estimated"),
                ],
            ),
            self._group(
                "Autonomia frente al sistema",
                [
                    self._metric(17, False, "Automatic system restorations", self._count(views, "agents_file_restored"), None, "count(agents_file_restored).", "High values suggest conflict with managed files.", self._count(views, "agents_file_restored"), "direct"),
                    self._metric(45, False, "Editing autonomy index", self._percent(len([event for event in views if event["type"] in {"file_changed", "file_saved", "file_created", "file_deleted", "active_editor_changed"}]), max(1, len(events) - heartbeat)), "%", "Direct observable actions over non-heartbeat events.", "Separates observable human interaction from systemic noise.", len(events), "estimated"),
                    self._metric(46, False, "Systemic dependency index", self._percent(len(systemic), len(events)), "%", "Heartbeat, restorations, protected files, or no-effect changes over total events.", "If high, filter before interpreting agency.", len(systemic), "estimated"),
                ],
            ),
            self._group(
                "Integridad y cumplimiento",
                [
                    self._metric(47, False, "Suspicious sequences on protected files", len(protected_sequences), None, self._protected_edit_detail(protected_sequences), "Protected file opening followed by change/save within a suspicious window. Review indicator, never an automatic accusation.", len(protected_sequences), "estimated"),
                    self._metric(48, True, "Integridad de la cadena hash", "continua" if hash_discontinuities == 0 else f"{hash_discontinuities} discontinuidades", None, "Checks previousHash against the previous hash.", "Affects confidence in log traceability.", len(events), "direct"),
                    self._metric(49, False, "Temporal discontinuities", temporal_gaps, None, "Pauses of 15 minutes or more between non-heartbeat actions.", "Helps avoid overinterpreting absence of events.", temporal_gaps, "direct"),
                ],
            ),
        ]
        return {
            "studentId": student_id,
            "groups": groups,
            "observableAgency": self._observable_agency(groups),
        }

    def _observable_agency(self, groups: list[dict]) -> dict:
        metrics = {
            metric.get("id"): metric
            for group in groups
            for metric in group.get("metrics", [])
            if isinstance(metric.get("id"), int)
        }

        def metric(metric_id: int) -> dict | None:
            return metrics.get(metric_id)

        def value(metric_id: int) -> float | None:
            return self._numeric_value(metric(metric_id).get("value") if metric(metric_id) else None)

        def dimension(name: str, weight: int, parts: list[tuple[float, str]]) -> dict:
            usable = [(score, text) for score, text in parts if isinstance(score, (int, float))]
            score = self._round(self._average(score for score, _ in usable)) if usable else 0
            return {
                "name": name,
                "score": score,
                "weight": weight,
                "evidence": [text for _, text in usable],
            }

        dimensions = [
            dimension(
                "Continuity",
                20,
                [
                    (self._cap(value(2), 30), self._evidence(metric(2))),
                    (self._cap(value(3), 30), self._evidence(metric(3))),
                    (self._cap(value(4), 1), self._evidence(metric(4))),
                    (self._inverse_count(value(49), 3), self._evidence(metric(49))),
                ],
            ),
            dimension(
                "Effective editing",
                25,
                [
                    (self._percent_score(value(6)), self._evidence(metric(6))),
                    (self._cap(value(9), 20), self._evidence(metric(9))),
                    (self._cap(value(7), 30), self._evidence(metric(7))),
                    (self._band(value(5), 0.1, 4), self._evidence(metric(5))),
                    (self._percent_score(value(33)), self._evidence(metric(33))),
                ],
            ),
            dimension(
                "Relevance",
                20,
                [
                    (self._percent_or_neutral(metric(12)), self._evidence(metric(12))),
                    (self._inverse_count(value(13), 8), self._evidence(metric(13))),
                    (self._inverse_percent(value(11), 100), self._evidence(metric(11))),
                ],
            ),
            dimension(
                "Process management",
                15,
                [
                    (self._cap(value(18), 3), self._evidence(metric(18))),
                    (self._band(value(19), 0.5, 8), self._evidence(metric(19))),
                    (self._percent_score(value(25)), self._evidence(metric(25))),
                    (self._percent_score(value(50)), self._evidence(metric(50))),
                ],
            ),
            dimension(
                "Iteration and refinement",
                10,
                [
                    (self._cap(value(37), 5), self._evidence(metric(37))),
                    (self._inverse_percent(value(38), 100), self._evidence(metric(38))),
                    (self._percent_score(value(33)), self._evidence(metric(33))),
                ],
            ),
            dimension(
                "Validation and submission",
                10,
                [
                    (self._cap(value(43), 3), self._evidence(metric(43))),
                    (self._cap(value(44), 3), self._evidence(metric(44))),
                    (self._cap(value(23), 1), self._evidence(metric(23))),
                    (self._percent_score(value(50)), self._evidence(metric(50))),
                ],
            ),
        ]

        total_weight = sum(item["weight"] for item in dimensions)
        weighted = sum(item["score"] * item["weight"] for item in dimensions)
        penalty = self._agency_penalty(metrics)
        score = max(0, min(100, self._round(weighted / max(1, total_weight) - penalty)))
        return {
            "score": score,
            "level": self._agency_level(score),
            "confidence": self._agency_confidence(list(metrics.values())),
            "dimensions": dimensions,
            "strengths": [
                f"{item['name']}: {item['score']}/100"
                for item in dimensions
                if item["score"] >= 70
            ],
            "flags": self._agency_flags(metrics, dimensions, penalty),
        }

    def _agency_level(self, score: float) -> str:
        if score >= 85:
            return "very high"
        if score >= 65:
            return "high"
        if score >= 40:
            return "medium"
        if score >= 15:
            return "low"
        return "insufficient"

    def _agency_confidence(self, metrics: list[dict]) -> str:
        evidence = sum(metric.get("evidenceCount") or 0 for metric in metrics)
        limited = len([metric for metric in metrics if metric.get("reliability") == "limited"])
        direct = len([metric for metric in metrics if metric.get("reliability") == "direct"])
        hash_value = next((metric.get("value") for metric in metrics if metric.get("id") == 48), None)
        if evidence >= 30 and direct >= limited and hash_value == "continua":
            return "high"
        if evidence >= 10 and limited < len(metrics) / 2:
            return "medium"
        return "limited"

    def _agency_penalty(self, metrics: dict[int, dict]) -> float:
        def value(metric_id: int) -> float:
            return self._numeric_value(metrics.get(metric_id, {}).get("value")) or 0

        penalty = 0
        penalty += min(12, value(30) * 3)
        penalty += min(12, value(32) * 2)
        penalty += min(10, value(47) * 3)
        penalty += min(10, value(49) * 2)
        systemic = self._numeric_value(metrics.get(46, {}).get("value"))
        if systemic is not None and systemic > 50:
            penalty += 8
        integrity = metrics.get(48, {}).get("value")
        if isinstance(integrity, str) and integrity != "continua":
            penalty += 10
        return penalty

    def _agency_flags(self, metrics: dict[int, dict], dimensions: list[dict], penalty: float) -> list[str]:
        flags = [
            f"{dimension['name']} con evidencia debil ({dimension['score']}/100)"
            for dimension in dimensions
            if dimension["score"] < 40
        ]

        def value(metric_id: int) -> float:
            return self._numeric_value(metrics.get(metric_id, {}).get("value")) or 0

        if value(30) > 0:
            flags.append("There are changes after the recorded submission")
        if value(32) > 0:
            flags.append("There are sudden massive changes to review in context")
        if value(47) > 0:
            flags.append("There is activity on protected or internal files")
        if value(49) > 0:
            flags.append("There are relevant temporal discontinuities")
        integrity = metrics.get(48, {}).get("value")
        if isinstance(integrity, str) and integrity != "continua":
            flags.append("La cadena hash no es continua")
        if penalty > 0:
            flags.append(f"Penalizacion contextual aplicada: {self._round(penalty)} puntos")
        return flags

    def _evidence(self, metric: dict | None) -> str:
        if not metric:
            return "Metric not available."
        unit = f" {metric.get('unit')}" if metric.get("unit") else ""
        return f"{metric.get('name')}: {metric.get('value')}{unit}"

    def _numeric_value(self, value) -> float | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value.replace(",", "."))
            except ValueError:
                return None
        return None

    def _cap(self, value: float | None, full_score_at: float) -> float:
        if value is None:
            return 0
        return max(0, min(100, (value / max(1, full_score_at)) * 100))

    def _percent_score(self, value: float | None) -> float:
        if value is None:
            return 0
        return max(0, min(100, value))

    def _inverse_count(self, value: float | None, zero_at: float) -> float:
        if value is None:
            return 100
        return max(0, min(100, 100 - (value / max(1, zero_at)) * 100))

    def _inverse_percent(self, value: float | None, zero_at: float) -> float:
        if value is None:
            return 50
        return max(0, min(100, 100 - (value / max(1, zero_at)) * 100))

    def _percent_or_neutral(self, metric: dict | None) -> float:
        if not metric:
            return 50
        if metric.get("reliability") == "limited":
            return 55
        return self._percent_score(self._numeric_value(metric.get("value")))

    def _band(self, value: float | None, low: float, high: float) -> float:
        if value is None:
            return 0
        if value < low:
            return max(0, (value / max(low, 0.1)) * 70)
        if value <= high:
            return 100
        return max(0, 100 - ((value - high) / max(high, 1)) * 60)

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

    def _external_integrity(self, events: list[dict], manifest: dict) -> dict:
        receipt_events = [
            event for event in events
            if self._event_type(event) == "event_server_receipt" and isinstance(event.get("data"), dict)
        ]
        if not receipt_events:
            return {
                "status": "not_available",
                "checkedReceipts": 0,
                "anchoredEvents": 0,
                "message": "No Repository event receipts are present",
            }
        event_server = ((manifest.get("repository") or {}).get("eventServer") or {}) if isinstance(manifest, dict) else {}
        public_key = event_server.get("publicSigningKey") if isinstance(event_server.get("publicSigningKey"), dict) else None
        expected_key_id = event_server.get("expectedSigningKeyId")
        expected_fingerprint = event_server.get("expectedPublicKeySha256")
        if not public_key:
            return {
                "status": "unverified",
                "checkedReceipts": len(receipt_events),
                "anchoredEvents": len({event["data"].get("anchoredEventHash") for event in receipt_events}),
                "message": "Repository receipts are present, but the activity manifest does not include a pinned public signing key",
            }
        if expected_fingerprint and public_key_fingerprint(public_key) != expected_fingerprint:
            return {
                "status": "invalid",
                "checkedReceipts": len(receipt_events),
                "anchoredEvents": 0,
                "message": "The Repository public signing key does not match the pinned fingerprint",
            }
        invalid = 0
        checked = 0
        anchored = set()
        first_server_seen_at = None
        last_server_seen_at = None
        for event in receipt_events:
            data = event["data"]
            receipt = data.get("receipt")
            if not isinstance(receipt, dict):
                invalid += 1
                continue
            payload = receipt.get("payload")
            signature = receipt.get("signature")
            signing_key_id = receipt.get("signingKeyId")
            if not isinstance(payload, dict) or not isinstance(signature, str):
                invalid += 1
                continue
            if expected_key_id and signing_key_id != expected_key_id:
                invalid += 1
                continue
            if payload.get("eventHash") != data.get("anchoredEventHash"):
                invalid += 1
                continue
            if not verify_payload_signature(public_key, payload, signature):
                invalid += 1
                continue
            checked += 1
            anchored.add(payload.get("eventHash"))
            server_seen = payload.get("serverReceivedAt")
            if isinstance(server_seen, str):
                first_server_seen_at = min(first_server_seen_at, server_seen) if first_server_seen_at else server_seen
                last_server_seen_at = max(last_server_seen_at, server_seen) if last_server_seen_at else server_seen
        status = "valid" if invalid == 0 and checked > 0 else "partial" if checked > 0 else "invalid"
        return {
            "status": status,
            "checkedReceipts": checked,
            "invalidReceipts": invalid,
            "anchoredEvents": len(anchored),
            "firstServerSeenAt": first_server_seen_at,
            "lastServerSeenAt": last_server_seen_at,
            "message": "Repository receipts validate against the pinned public key" if status == "valid" else "Some Repository receipts could not be verified",
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
            return self._normalize_path(event["file"])
        data = event.get("data")
        if isinstance(data, dict) and isinstance(data.get("file"), str):
            return self._normalize_path(data["file"])
        return None

    def _normalize_path(self, file: str) -> str:
        return file.replace("\\", "/").lstrip("./")

    def _is_work_source_file(self, file: str) -> bool:
        return self._normalize_path(file).startswith("src/")

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

    def _protected_edit_detail(self, sequences: list[dict]) -> str:
        if not sequences:
            return "No hay apertura de archivo protegido seguida por cambio/guardado sospechoso."
        return "; ".join(f"{sequence['file']}: {sequence['opened']['type']} -> {sequence['change']['type']}" for sequence in sequences)

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
            positives.append("Task start recorded")
        if input["file_change_events"] >= 3 or input["unique_lines_touched"] >= 5:
            score += 2
            positives.append("There is sustained editing in work files")
        elif input["file_change_events"] > 0:
            score += 1
            positives.append("Own changes are recorded")
        else:
            concerns.append("Not enough file changes are recorded")
        if input["files_modified"] > 1:
            score += 1
            positives.append("Trabajo distribuido en mas de un archivo")
        if input["active_minutes"] >= 10:
            score += 1
            positives.append("Sesion de trabajo con duracion observable")
        if input["tasks_completed"] > 0:
            score += 1
            positives.append("Task completion recorded")
        if input["student_messages"] > 0 and input["agent_messages"] > 0:
            score += 1
            positives.append("Uso dialogado del agente")
        if input["agent_messages"] > input["student_messages"] * 3 and input["file_change_events"] < 3:
            concerns.append("Many agent responses with little later editing")
            score -= 1
        if input["heartbeat_gaps"] > 0:
            concerns.append("There are long pauses between events; review continuity")
        return {"score": max(0, min(6, score)), "level": "high" if score >= 5 else "medium" if score >= 3 else "low", "positives": positives, "concerns": concerns}

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
            return "No calculable pauses."
        ordered = sorted(values)
        median = ordered[len(ordered) // 2]
        p90 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.9))]
        return f"median {median} min, p90 {p90} min, >5 min: {len([value for value in values if value > 5])}."

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
