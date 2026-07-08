import json
import hashlib
import zipfile
from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase

from core.models import ActivityVersion, Course, CourseGroup, ImportWarning, Submission
from core.services.activity_import import ActivityZipImportService
from core.services.safe_zip import ZipValidationError
from core.services.submission_import import SubmissionZipImportService


def zip_upload(name, entries):
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        for path, value in entries.items():
            if isinstance(value, (dict, list)):
                value = json.dumps(value)
            zf.writestr(path, value)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="application/zip")


def manifest(version="1.0.0"):
    return {
        "id": "poo-basico-01",
        "title": "POO basico",
        "description": "Actividad de objetos",
        "version": version,
        "tasks": [
            {"id": "encapsulation", "title": "Encapsulamiento", "file": "tasks/encapsulation.md"},
            {"id": "behavior", "title": "Comportamiento", "file": "tasks/behavior.md"},
        ],
    }


def hashed_events(rows):
    previous_hash = None
    result = []
    for row in rows:
        event = {**row, "previousHash": previous_hash}
        event_hash = hashlib.sha256(
            f"{previous_hash or ''}{json.dumps(event, sort_keys=True, separators=(',', ':'), ensure_ascii=False)}".encode("utf-8")
        ).hexdigest()
        event["hash"] = event_hash
        previous_hash = event_hash
        result.append(event)
    return result


def activity_zip(version="1.0.0", container=False):
    root = "activity/" if container else ""
    return zip_upload(
        f"activity-{version}.zip",
        {
            root + "manifest.json": manifest(version),
            root + "agent/instructions.md": "Trabaja con cuidado.",
            root + "starter/proyecto-base/package.json": "{}",
            root + "tasks/encapsulation.md": "# Tarea",
        },
    )


def submission_zip(with_git=False, with_agent=True, invalid_jsonl=False):
    events = [
        json.dumps({"timestamp": "2026-06-11T10:00:00Z", "event": "task_started", "taskId": "encapsulation"}),
        json.dumps({"timestamp": "2026-06-11T10:10:00Z", "event": "task_finished", "taskId": "encapsulation"}),
        json.dumps({"timestamp": "2026-06-11T10:11:00Z", "event": "submission_exported"}),
    ]
    if invalid_jsonl:
        events.append("{broken")

    entries = {
        ".vsc4education/activity-manifest.json": manifest(),
        ".vsc4education/activity-configuration.json": {"loadedAt": "2026-06-11T09:00:00Z"},
        ".vsc4education/contributions/ana-001/profile.json": {
            "firstName": "Ana",
            "lastName": "Garcia",
            "institutionalId": "ana-001",
        },
        ".vsc4education/contributions/ana-001/state.json": {
            "tasks": {"encapsulation": {"status": "completed"}, "behavior": {"status": "pending"}},
        },
        ".vsc4education/contributions/ana-001/events.jsonl": "\n".join(events),
        ".vsc4education/contributions/ana-001/task-metadata/encapsulation.json": {
            "durationSeconds": 600,
            "saveCount": 3,
            "modifiedFiles": ["src/Animal.ts"],
        },
        "src/Animal.ts": "export class Animal {}",
    }
    if with_agent:
        entries[".vsc4education/contributions/ana-001/agent-interactions.jsonl"] = "\n".join(
            [
                json.dumps({"timestamp": "2026-06-11T10:01:00Z", "actor": "student", "message": "Ayuda"}),
                json.dumps({"timestamp": "2026-06-11T10:02:00Z", "actor": "agent", "agent": "chatGPT", "message": "Piensa en atributos privados"}),
            ]
        )
    if with_git:
        entries[".git/HEAD"] = "ref: refs/heads/main"
    return zip_upload("submission.zip", entries)


def review_submission_zip(tampered=False):
    events = hashed_events(
        [
            {"timestamp": "2026-06-11T10:00:00Z", "event": "task_started", "taskId": "encapsulation"},
            {
                "timestamp": "2026-06-11T10:03:00Z",
                "event": "file_changed",
                "taskId": "encapsulation",
                "data": {"file": "src/Animal.ts", "changeCount": 2, "lines": [{"start": 1, "end": 3}]},
            },
            {"timestamp": "2026-06-11T10:05:00Z", "event": "file_saved", "taskId": "encapsulation", "data": {"file": "src/Animal.ts"}},
            {"timestamp": "2026-06-11T10:10:00Z", "event": "task_finished", "taskId": "encapsulation"},
            {"timestamp": "2026-06-11T10:11:00Z", "event": "submission_exported"},
        ]
    )
    if tampered:
        events[1]["data"]["changeCount"] = 99
    return zip_upload(
        "review-submission.zip",
        {
            ".vsc4education/activity-manifest.json": manifest(),
            ".vsc4education/activity-configuration.json": {"loadedAt": "2026-06-11T09:00:00Z"},
            ".vsc4education/contributions/ana-001/profile.json": {"firstName": "Ana", "lastName": "Garcia"},
            ".vsc4education/contributions/ana-001/state.json": {"tasks": {"encapsulation": {"status": "completed"}}},
            ".vsc4education/contributions/ana-001/events.jsonl": "\n".join(json.dumps(event) for event in events),
            ".vsc4education/contributions/ana-001/agent-interactions.jsonl": "\n".join(
                [
                    json.dumps({"timestamp": "2026-06-11T10:01:00Z", "actor": "student", "message": "Ayuda", "taskId": "encapsulation"}),
                    json.dumps({"timestamp": "2026-06-11T10:02:00Z", "actor": "agent", "agent": "chatGPT", "message": "Piensa en atributos privados", "taskId": "encapsulation"}),
                ]
            ),
            "src/Animal.ts": "export class Animal {}",
        },
    )


class ImportServicesTests(TestCase):
    def test_import_activity_zip(self):
        activity_version = ActivityZipImportService().import_zip(activity_zip())

        self.assertEqual(activity_version.activity.activity_id, "poo-basico-01")
        self.assertEqual(activity_version.version, "1.0.0")
        self.assertEqual(activity_version.tasks.count(), 2)

    def test_import_activity_zip_with_single_container(self):
        activity_version = ActivityZipImportService().import_zip(activity_zip(container=True))

        self.assertEqual(activity_version.activity.activity_id, "poo-basico-01")

    def test_import_two_versions_of_same_activity(self):
        ActivityZipImportService().import_zip(activity_zip("1.0.0"))
        ActivityZipImportService().import_zip(activity_zip("1.1.0"))

        self.assertEqual(ActivityVersion.objects.count(), 2)

    def test_import_submission_without_git_or_agent_interactions(self):
        activity_version = ActivityZipImportService().import_zip(activity_zip())
        submission = SubmissionZipImportService().import_zip(submission_zip(with_git=False, with_agent=False), activity_version)

        self.assertFalse(submission.has_git)
        self.assertEqual(submission.agent_interaction_count, 0)
        self.assertEqual(submission.task_states.count(), 2)
        self.assertTrue(ImportWarning.objects.filter(submission=submission, code="missing_agent_interactions").exists())

    def test_import_submission_with_git_and_agent_interactions(self):
        activity_version = ActivityZipImportService().import_zip(activity_zip())
        submission = SubmissionZipImportService().import_zip(submission_zip(with_git=True, with_agent=True), activity_version)

        self.assertTrue(submission.has_git)
        self.assertEqual(submission.agent_interaction_count, 2)
        self.assertEqual(submission.agent_summary.providers, ["chatGPT"])

    def test_import_submission_with_partially_invalid_jsonl(self):
        activity_version = ActivityZipImportService().import_zip(activity_zip())
        submission = SubmissionZipImportService().import_zip(submission_zip(invalid_jsonl=True), activity_version)

        self.assertEqual(submission.event_count, 3)
        self.assertTrue(ImportWarning.objects.filter(submission=submission, code="invalid_events_jsonl_lines").exists())

    def test_reject_required_corrupt_json(self):
        activity_version = ActivityZipImportService().import_zip(activity_zip())
        broken = zip_upload(
            "broken.zip",
            {
                ".vsc4education/activity-manifest.json": "{broken",
                ".vsc4education/activity-configuration.json": {},
                ".vsc4education/contributions/ana-001/profile.json": {},
                ".vsc4education/contributions/ana-001/state.json": {},
                ".vsc4education/contributions/ana-001/events.jsonl": "",
            },
        )

        with self.assertRaises(ZipValidationError):
            SubmissionZipImportService().import_zip(broken, activity_version)

    def test_reject_path_traversal(self):
        unsafe = zip_upload("unsafe.zip", {"../manifest.json": manifest()})

        with self.assertRaises(ZipValidationError):
            ActivityZipImportService().import_zip(unsafe)

    def test_duplicate_same_zip_returns_existing_activity_version(self):
        first = ActivityZipImportService().import_zip(activity_zip())
        second = ActivityZipImportService().import_zip(activity_zip())

        self.assertEqual(first.id, second.id)
        self.assertEqual(ActivityVersion.objects.count(), 1)

    def test_submission_checksum_duplicate_returns_existing_submission(self):
        activity_version = ActivityZipImportService().import_zip(activity_zip())
        first_upload = submission_zip()
        second_upload = SimpleUploadedFile("submission.zip", first_upload.read(), content_type="application/zip")
        first = SubmissionZipImportService().import_zip(first_upload, activity_version)
        second = SubmissionZipImportService().import_zip(second_upload, activity_version)

        self.assertEqual(first.id, second.id)
        self.assertEqual(Submission.objects.count(), 1)

    def test_course_activity_versions_endpoint(self):
        course = Course.objects.create(name="Programacion I", code="PI")
        group = CourseGroup.objects.create(course=course, name="1", term="2026")
        activity_version = ActivityZipImportService().import_zip(activity_zip(), course_group=group)

        response = Client().get(f"/api/courses/{course.id}/activity-versions/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["id"], activity_version.id)
        self.assertEqual(response.json()[0]["courseGroups"][0]["id"], group.id)

    def test_submission_review_endpoint_returns_teacher_like_sections(self):
        activity_version = ActivityZipImportService().import_zip(activity_zip())
        submission = SubmissionZipImportService().import_zip(review_submission_zip(), activity_version)

        response = Client().get(f"/api/submissions/{submission.id}/review/")
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data["integrity"]["status"], "valid")
        self.assertEqual(data["summary"]["filesModified"], 1)
        self.assertEqual(data["summary"]["agentInteractions"], 2)
        self.assertEqual(data["agentInteractions"][0]["actor"], "student")
        self.assertTrue(data["agencyMetrics"]["groups"])
        metric_names = [metric["name"] for group in data["agencyMetrics"]["groups"] for metric in group["metrics"]]
        self.assertIn("Integridad de la cadena hash", metric_names)

    def test_submission_review_endpoint_detects_hash_mismatch(self):
        activity_version = ActivityZipImportService().import_zip(activity_zip())
        submission = SubmissionZipImportService().import_zip(review_submission_zip(tampered=True), activity_version)

        response = Client().get(f"/api/submissions/{submission.id}/review/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["integrity"]["status"], "invalid")

    def test_activity_review_dashboard_aggregates_submission_reviews(self):
        activity_version = ActivityZipImportService().import_zip(activity_zip())
        SubmissionZipImportService().import_zip(review_submission_zip(), activity_version)
        SubmissionZipImportService().import_zip(review_submission_zip(tampered=True), activity_version)

        response = Client().get(f"/api/activity-versions/{activity_version.id}/review-dashboard/")
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data["submissionCount"], 2)
        self.assertEqual(data["reviewedSubmissionCount"], 2)
        self.assertEqual(data["summary"]["agentInteractions"]["avg"], 2)
        self.assertEqual(data["summary"]["uniqueLinesTouched"]["min"], 3)
        self.assertEqual(data["integrity"]["valid"], 1)
        self.assertEqual(data["integrity"]["invalid"], 1)
        self.assertTrue(data["metricGroups"])
