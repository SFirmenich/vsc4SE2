import zipfile
from collections import Counter
from datetime import datetime
from io import BytesIO

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils.dateparse import parse_datetime

from core.models import (
    ActivityVersion,
    ImportWarning,
    Student,
    Submission,
    SubmissionAgentSummary,
    SubmissionEventSummary,
    SubmissionTaskState,
)
from core.services.safe_zip import (
    ZipValidationError,
    build_name_map,
    event_counter,
    find_file,
    read_json,
    read_jsonl,
    sha256_file,
    validate_zip,
)


class SubmissionZipImportService:
    def import_zip(self, uploaded_file, activity_version=None, course_group=None) -> Submission:
        checksum, data = sha256_file(uploaded_file)
        filename = uploaded_file.name or "submission.zip"

        with zipfile.ZipFile(BytesIO(data)) as zf:
            validate_zip(zf)
            name_map = build_name_map(zf)
            parsed = self._parse_submission(zf, name_map)

        if activity_version is None:
            activity_version = self._resolve_activity_version(parsed["activity_manifest"])
        elif not self._matches_activity_version(activity_version, parsed["activity_manifest"]):
            raise ZipValidationError("Submission activity manifest does not match the selected ActivityVersion")

        with transaction.atomic():
            existing = Submission.objects.filter(checksum_sha256=checksum).first()
            if existing:
                return existing

            profile = parsed["profile"]
            student_id = parsed["contribution_id"]
            student, _ = Student.objects.update_or_create(
                institutional_id=student_id,
                defaults={
                    "first_name": profile.get("firstName") or profile.get("first_name") or "",
                    "last_name": profile.get("lastName") or profile.get("last_name") or "",
                    "display_name": self._display_name(profile, student_id),
                },
            )

            submission = Submission.objects.create(
                activity_version=activity_version,
                course_group=course_group,
                student=student,
                checksum_sha256=checksum,
                activity_manifest=parsed["activity_manifest"],
                activity_configuration=parsed["activity_configuration"],
                contribution_id=student_id,
                state=parsed["state"],
                has_git=parsed["has_git"],
                event_count=len(parsed["events"]),
                agent_interaction_count=len(parsed["agent_interactions"]),
                exported_at=parsed["exported_at"],
            )
            submission.original_zip.save(filename, ContentFile(data), save=True)

            for event_type, count in parsed["event_counts"].items():
                SubmissionEventSummary.objects.create(submission=submission, event_type=event_type, count=count)

            SubmissionAgentSummary.objects.create(submission=submission, **parsed["agent_summary"])

            for task_state in parsed["task_states"]:
                SubmissionTaskState.objects.create(submission=submission, **task_state)

            warnings = parsed["warnings"]
            for warning in warnings:
                ImportWarning.objects.create(submission=submission, **warning)
            if warnings:
                submission.warning_count = len(warnings)
                submission.save(update_fields=["warning_count"])

            return submission

    def _parse_submission(self, zf: zipfile.ZipFile, name_map: dict[str, str]) -> dict:
        manifest_name = find_file(name_map, ".vsc4education/activity-manifest.json")
        config_name = find_file(name_map, ".vsc4education/activity-configuration.json")
        if not manifest_name:
            raise ZipValidationError("Submission ZIP must contain .vsc4education/activity-manifest.json")
        if not config_name:
            raise ZipValidationError("Submission ZIP must contain .vsc4education/activity-configuration.json")

        activity_manifest = read_json(zf, manifest_name)
        activity_configuration = read_json(zf, config_name)
        contribution_id = self._find_contribution_id(name_map)
        base = f".vsc4education/contributions/{contribution_id}/"
        prefix = self._actual_prefix(name_map, base)

        profile = read_json(zf, self._required(name_map, prefix + "profile.json"))
        state = read_json(zf, self._required(name_map, prefix + "state.json"))
        events_result = read_jsonl(zf, self._required(name_map, prefix + "events.jsonl"))

        agent_name = self._optional(name_map, prefix + "agent-interactions.jsonl")
        agent_result = read_jsonl(zf, agent_name) if agent_name else None

        warnings = []
        if events_result.invalid_lines:
            warnings.append({
                "code": "invalid_events_jsonl_lines",
                "message": "Some events.jsonl lines could not be parsed",
                "details": {"lines": events_result.invalid_lines},
            })
        if not agent_name:
            warnings.append({"code": "missing_agent_interactions", "message": "agent-interactions.jsonl was not found", "details": {}})
        elif agent_result and agent_result.invalid_lines:
            warnings.append({
                "code": "invalid_agent_jsonl_lines",
                "message": "Some agent-interactions.jsonl lines could not be parsed",
                "details": {"lines": agent_result.invalid_lines},
            })

        contribution_count = len(self._contribution_ids(name_map))
        if contribution_count > 1:
            warnings.append({
                "code": "multiple_contributions",
                "message": "Multiple contribution directories were found; imported the first one",
                "details": {"count": contribution_count},
            })

        events = events_result.rows
        agent_interactions = agent_result.rows if agent_result else []
        event_counts = event_counter(events)
        exported_at = self._find_exported_at(events)

        return {
            "activity_manifest": activity_manifest,
            "activity_configuration": activity_configuration,
            "contribution_id": contribution_id,
            "profile": profile,
            "state": state,
            "events": events,
            "event_counts": event_counts,
            "agent_interactions": agent_interactions,
            "agent_summary": self._agent_summary(agent_interactions),
            "task_states": self._task_states(activity_manifest, state, name_map, zf, prefix),
            "has_git": any(name.startswith(".git/") or "/.git/" in name for name in name_map),
            "exported_at": exported_at,
            "warnings": warnings,
        }

    def _resolve_activity_version(self, manifest: dict) -> ActivityVersion:
        activity_id = manifest.get("id")
        version = manifest.get("version")
        try:
            return ActivityVersion.objects.get(activity__activity_id=activity_id, version=version)
        except ActivityVersion.DoesNotExist as exc:
            raise ZipValidationError(f"No ActivityVersion found for {activity_id}@{version}") from exc

    def _matches_activity_version(self, activity_version: ActivityVersion, manifest: dict) -> bool:
        return activity_version.activity.activity_id == manifest.get("id") and activity_version.version == manifest.get("version")

    def _contribution_ids(self, name_map: dict[str, str]) -> list[str]:
        ids = set()
        for name in name_map:
            marker = ".vsc4education/contributions/"
            if marker in name:
                tail = name.split(marker, 1)[1]
                if "/" in tail:
                    ids.add(tail.split("/", 1)[0])
        return sorted(ids)

    def _find_contribution_id(self, name_map: dict[str, str]) -> str:
        ids = self._contribution_ids(name_map)
        if not ids:
            raise ZipValidationError("Submission ZIP must contain .vsc4education/contributions/<studentId>/")
        return ids[0]

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

    def _display_name(self, profile: dict, fallback: str) -> str:
        first = profile.get("firstName") or profile.get("first_name") or ""
        last = profile.get("lastName") or profile.get("last_name") or ""
        return " ".join(part for part in [first, last] if part).strip() or profile.get("name") or fallback

    def _find_exported_at(self, events: list[dict]) -> datetime | None:
        for event in reversed(events):
            event_type = event.get("event") or event.get("type")
            if event_type == "submission_exported":
                timestamp = event.get("timestamp")
                return parse_datetime(timestamp) if timestamp else None
        return None

    def _agent_summary(self, interactions: list[dict]) -> dict:
        providers = sorted({row.get("agent") for row in interactions if row.get("agent")})
        actor_counts = Counter(str(row.get("actor", "")) for row in interactions)
        return {
            "total_messages": len(interactions),
            "student_messages": actor_counts.get("student", 0),
            "agent_messages": sum(count for actor, count in actor_counts.items() if actor and actor != "student"),
            "providers": providers,
        }

    def _task_states(self, manifest: dict, state: dict, name_map: dict[str, str], zf: zipfile.ZipFile, contribution_prefix: str) -> list[dict]:
        status_by_task = {}
        raw_tasks = state.get("tasks")
        if isinstance(raw_tasks, dict):
            for task_id, value in raw_tasks.items():
                status_by_task[str(task_id)] = value.get("status", "") if isinstance(value, dict) else str(value)
        elif isinstance(raw_tasks, list):
            for value in raw_tasks:
                if isinstance(value, dict) and value.get("id"):
                    status_by_task[str(value["id"])] = value.get("status", "")

        result = []
        for task in manifest.get("tasks", []):
            task_id = task.get("id")
            if not task_id:
                continue
            metadata = self._task_metadata(name_map, zf, contribution_prefix, task_id)
            result.append({
                "task_id": task_id,
                "status": status_by_task.get(task_id) or metadata.get("status", ""),
                "duration_seconds": metadata.get("durationSeconds") or metadata.get("duration_seconds"),
                "save_count": int(metadata.get("saveCount") or metadata.get("save_count") or 0),
                "modified_files_count": len(metadata.get("modifiedFiles") or metadata.get("modified_files") or []),
                "metadata": metadata,
            })
        return result

    def _task_metadata(self, name_map: dict[str, str], zf: zipfile.ZipFile, contribution_prefix: str, task_id: str) -> dict:
        candidates = [
            contribution_prefix + f"task-metadata/{task_id}.json",
            contribution_prefix + f"task-metadata/{task_id}.metadata.json",
        ]
        for candidate in candidates:
            archive_name = self._optional(name_map, candidate)
            if archive_name:
                try:
                    return read_json(zf, archive_name)
                except ZipValidationError:
                    return {}
        return {}
