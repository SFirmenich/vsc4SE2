from django.conf import settings
from django.db import models


class Course(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=80, blank=True)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "code"]

    def __str__(self):
        return self.name


class CourseGroup(models.Model):
    course = models.ForeignKey(Course, related_name="groups", on_delete=models.CASCADE)
    name = models.CharField(max_length=200)
    term = models.CharField(max_length=120, blank=True)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["course__name", "name"]
        unique_together = [("course", "name", "term")]

    def __str__(self):
        suffix = f" ({self.term})" if self.term else ""
        return f"{self.course.name} - {self.name}{suffix}"


class LearningActivity(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    activity_id = models.CharField(max_length=160, unique=True)
    title = models.CharField(max_length=240)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["activity_id"]

    def __str__(self):
        return f"{self.activity_id}: {self.title}"


def activity_zip_upload_to(instance, filename):
    return f"activities/{instance.activity.activity_id}/{instance.version}/{filename}"


class ActivityVersion(models.Model):
    activity = models.ForeignKey(LearningActivity, related_name="versions", on_delete=models.CASCADE)
    version = models.CharField(max_length=80)
    title = models.CharField(max_length=240)
    description = models.TextField(blank=True)
    manifest = models.JSONField(default=dict)
    original_zip = models.FileField(upload_to=activity_zip_upload_to)
    checksum_sha256 = models.CharField(max_length=64, unique=True)
    course_groups = models.ManyToManyField(CourseGroup, related_name="activity_versions", blank=True)
    imported_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["activity__activity_id", "version"]
        unique_together = [("activity", "version")]

    def __str__(self):
        return f"{self.activity.activity_id}@{self.version}"


class ActivityTask(models.Model):
    activity_version = models.ForeignKey(ActivityVersion, related_name="tasks", on_delete=models.CASCADE)
    task_id = models.CharField(max_length=160)
    title = models.CharField(max_length=240)
    description = models.TextField(blank=True)
    file = models.CharField(max_length=500, blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["activity_version", "order", "task_id"]
        unique_together = [("activity_version", "task_id")]

    def __str__(self):
        return f"{self.activity_version}: {self.task_id}"


class Student(models.Model):
    institutional_id = models.CharField(max_length=160, unique=True)
    first_name = models.CharField(max_length=160, blank=True)
    last_name = models.CharField(max_length=160, blank=True)
    display_name = models.CharField(max_length=240, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["institutional_id"]

    def __str__(self):
        return self.display_name or self.institutional_id


class EventIngestionToken(models.Model):
    activity_version = models.ForeignKey(ActivityVersion, related_name="event_ingestion_tokens", on_delete=models.CASCADE)
    course_group = models.ForeignKey(CourseGroup, related_name="event_ingestion_tokens", null=True, blank=True, on_delete=models.CASCADE)
    name = models.CharField(max_length=160, blank=True)
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class EventIngestionSession(models.Model):
    activity_version = models.ForeignKey(ActivityVersion, related_name="event_ingestion_sessions", on_delete=models.CASCADE)
    course_group = models.ForeignKey(CourseGroup, related_name="event_ingestion_sessions", null=True, blank=True, on_delete=models.SET_NULL)
    student = models.ForeignKey(Student, related_name="event_ingestion_sessions", on_delete=models.CASCADE)
    contribution_id = models.CharField(max_length=160)
    client_session_id = models.CharField(max_length=160)
    session_token_hash = models.CharField(max_length=64, unique=True)
    started_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    last_event_hash = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["-started_at"]
        unique_together = [("activity_version", "student", "contribution_id", "client_session_id")]


class EventReceipt(models.Model):
    session = models.ForeignKey(EventIngestionSession, related_name="receipts", on_delete=models.CASCADE)
    event_id = models.CharField(max_length=160)
    sequence = models.PositiveIntegerField()
    event_hash = models.CharField(max_length=64)
    previous_hash = models.CharField(max_length=64, blank=True)
    client_timestamp = models.DateTimeField(null=True, blank=True)
    envelope_sha256 = models.CharField(max_length=64)
    server_received_at = models.DateTimeField(auto_now_add=True)
    signing_key_id = models.CharField(max_length=120)
    signature = models.TextField()
    payload = models.JSONField(default=dict)

    class Meta:
        ordering = ["session", "sequence"]
        unique_together = [("session", "event_id")]


def submission_zip_upload_to(instance, filename):
    activity_id = instance.activity_version.activity.activity_id
    version = instance.activity_version.version
    return f"submissions/{activity_id}/{version}/{instance.student.institutional_id}/{filename}"


class Submission(models.Model):
    activity_version = models.ForeignKey(ActivityVersion, related_name="submissions", on_delete=models.CASCADE)
    course_group = models.ForeignKey(CourseGroup, related_name="submissions", null=True, blank=True, on_delete=models.SET_NULL)
    student = models.ForeignKey(Student, related_name="submissions", on_delete=models.CASCADE)
    name = models.CharField(max_length=240, blank=True)
    original_zip = models.FileField(upload_to=submission_zip_upload_to)
    checksum_sha256 = models.CharField(max_length=64, unique=True)
    activity_manifest = models.JSONField(default=dict)
    activity_configuration = models.JSONField(default=dict)
    contribution_id = models.CharField(max_length=160)
    state = models.JSONField(default=dict)
    has_git = models.BooleanField(default=False)
    event_count = models.PositiveIntegerField(default=0)
    agent_interaction_count = models.PositiveIntegerField(default=0)
    warning_count = models.PositiveIntegerField(default=0)
    exported_at = models.DateTimeField(null=True, blank=True)
    imported_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-imported_at"]

    def __str__(self):
        prefix = self.name or str(self.student)
        return f"{prefix} -> {self.activity_version}"


class SubmissionTaskState(models.Model):
    submission = models.ForeignKey(Submission, related_name="task_states", on_delete=models.CASCADE)
    task_id = models.CharField(max_length=160)
    status = models.CharField(max_length=80, blank=True)
    duration_seconds = models.FloatField(null=True, blank=True)
    save_count = models.PositiveIntegerField(default=0)
    modified_files_count = models.PositiveIntegerField(default=0)
    metadata = models.JSONField(default=dict)

    class Meta:
        ordering = ["submission", "task_id"]
        unique_together = [("submission", "task_id")]


class SubmissionEventSummary(models.Model):
    submission = models.ForeignKey(Submission, related_name="event_summaries", on_delete=models.CASCADE)
    event_type = models.CharField(max_length=160)
    count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["submission", "event_type"]
        unique_together = [("submission", "event_type")]


class SubmissionAgentSummary(models.Model):
    submission = models.OneToOneField(Submission, related_name="agent_summary", on_delete=models.CASCADE)
    total_messages = models.PositiveIntegerField(default=0)
    student_messages = models.PositiveIntegerField(default=0)
    agent_messages = models.PositiveIntegerField(default=0)
    providers = models.JSONField(default=list)


class ImportWarning(models.Model):
    activity_version = models.ForeignKey(ActivityVersion, related_name="warnings", null=True, blank=True, on_delete=models.CASCADE)
    submission = models.ForeignKey(Submission, related_name="warnings", null=True, blank=True, on_delete=models.CASCADE)
    code = models.CharField(max_length=120)
    message = models.TextField()
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
