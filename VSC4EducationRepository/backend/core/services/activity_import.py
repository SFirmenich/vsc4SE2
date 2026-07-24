import zipfile
from io import BytesIO

from django.core.files.base import ContentFile
from django.db import transaction

from core.models import ActivityTask, ActivityVersion, ImportWarning, LearningActivity
from core.services.safe_zip import (
    ZipValidationError,
    build_name_map,
    find_file,
    find_prefix,
    read_json,
    sha256_file,
    validate_zip,
)


class ActivityZipImportService:
    def import_zip(self, uploaded_file, owner=None, course_group=None) -> ActivityVersion:
        checksum, data = sha256_file(uploaded_file)
        filename = uploaded_file.name or "activity.zip"

        with zipfile.ZipFile(BytesIO(data)) as zf:
            validate_zip(zf)
            name_map = build_name_map(zf)
            manifest_name = find_file(name_map, "manifest.json")
            if not manifest_name:
                raise ZipValidationError("Activity ZIP must contain manifest.json at root or inside a single container directory")
            manifest = read_json(zf, manifest_name)
            self._validate_manifest(manifest)
            warnings = self._collect_warnings(name_map)

        with transaction.atomic():
            activity, _ = LearningActivity.objects.update_or_create(
                activity_id=manifest["id"],
                defaults={
                    "owner": owner,
                    "title": manifest["title"],
                    "description": manifest.get("description", ""),
                },
            )

            existing = ActivityVersion.objects.filter(activity=activity, version=manifest.get("version", "")).first()
            if existing:
                if existing.checksum_sha256 == checksum:
                    if course_group:
                        existing.course_groups.add(course_group)
                    return existing
                if existing.status != ActivityVersion.STATUS_DRAFT:
                    raise ZipValidationError("An activity with the same id and version already exists with a different ZIP checksum")
                existing_event_server = ((existing.manifest or {}).get("repository") or {}).get("eventServer")
                if existing_event_server and not ((manifest.get("repository") or {}).get("eventServer")):
                    manifest["repository"] = {
                        **(manifest.get("repository") or {}),
                        "eventServer": existing_event_server,
                    }
                existing.title = manifest["title"]
                existing.description = manifest.get("description", "")
                existing.manifest = manifest
                existing.checksum_sha256 = checksum
                existing.status = ActivityVersion.STATUS_IMPORTED
                existing.original_zip.save(filename, ContentFile(data), save=False)
                existing.save()
                if course_group:
                    existing.course_groups.add(course_group)
                existing.tasks.all().delete()
                activity_version = existing
            else:
                activity_version = ActivityVersion.objects.create(
                    activity=activity,
                    version=manifest.get("version", ""),
                    title=manifest["title"],
                    description=manifest.get("description", ""),
                    manifest=manifest,
                    checksum_sha256=checksum,
                    status=ActivityVersion.STATUS_IMPORTED,
                )
                activity_version.original_zip.save(filename, ContentFile(data), save=True)
                if course_group:
                    activity_version.course_groups.add(course_group)

            for index, task in enumerate(manifest["tasks"]):
                ActivityTask.objects.create(
                    activity_version=activity_version,
                    task_id=task["id"],
                    title=task["title"],
                    description=task.get("description", ""),
                    file=task.get("file", ""),
                    order=index,
                )

            for warning in warnings:
                ImportWarning.objects.create(activity_version=activity_version, **warning)

            return activity_version

    def _validate_manifest(self, manifest: dict) -> None:
        if not manifest.get("id") or not manifest.get("title"):
            raise ZipValidationError("Activity manifest requires id and title")
        if "version" not in manifest or not str(manifest.get("version")).strip():
            raise ZipValidationError("Activity manifest requires version")
        tasks = manifest.get("tasks")
        if not isinstance(tasks, list) or not tasks:
            raise ZipValidationError("Activity manifest requires a non-empty tasks list")
        seen = set()
        for task in tasks:
            if not isinstance(task, dict) or not task.get("id") or not task.get("title"):
                raise ZipValidationError("Each activity task requires id and title")
            if task["id"] in seen:
                raise ZipValidationError(f"Duplicate task id: {task['id']}")
            seen.add(task["id"])

    def _collect_warnings(self, name_map: dict[str, str]) -> list[dict]:
        warnings = []
        if not find_prefix(name_map, "starter"):
            warnings.append(
                {"code": "missing_starter", "message": "starter/ was not found", "details": {}}
            )
        if not find_file(name_map, "agent/instructions.md"):
            warnings.append({"code": "missing_agent_instructions", "message": "agent/instructions.md was not found", "details": {}})
        return warnings
