from rest_framework import serializers

from core.models import (
    ActivityTask,
    ActivityVersion,
    Course,
    CourseGroup,
    ImportWarning,
    LearningActivity,
    Student,
    Submission,
    SubmissionAgentSummary,
    SubmissionEventSummary,
    SubmissionTaskState,
)


class CourseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Course
        fields = ["id", "name", "code", "description", "created_at", "updated_at"]


class CourseGroupSerializer(serializers.ModelSerializer):
    courseName = serializers.CharField(source="course.name", read_only=True)

    class Meta:
        model = CourseGroup
        fields = ["id", "course", "courseName", "name", "term", "description", "created_at", "updated_at"]


class ActivityTaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityTask
        fields = ["id", "task_id", "title", "description", "file", "order"]


class ActivityVersionListSerializer(serializers.ModelSerializer):
    activityId = serializers.CharField(source="activity.activity_id", read_only=True)
    submissionCount = serializers.IntegerField(source="submissions.count", read_only=True)
    courseGroups = CourseGroupSerializer(source="course_groups", many=True, read_only=True)

    class Meta:
        model = ActivityVersion
        fields = [
            "id",
            "activity",
            "activityId",
            "version",
            "title",
            "description",
            "checksum_sha256",
            "courseGroups",
            "submissionCount",
            "imported_at",
        ]


class ActivityVersionDetailSerializer(ActivityVersionListSerializer):
    tasks = ActivityTaskSerializer(many=True, read_only=True)
    course_groups = CourseGroupSerializer(many=True, read_only=True)
    originalZipUrl = serializers.FileField(source="original_zip", read_only=True)

    class Meta(ActivityVersionListSerializer.Meta):
        fields = ActivityVersionListSerializer.Meta.fields + ["manifest", "tasks", "course_groups", "originalZipUrl"]


class LearningActivitySerializer(serializers.ModelSerializer):
    versions = ActivityVersionListSerializer(many=True, read_only=True)

    class Meta:
        model = LearningActivity
        fields = ["id", "activity_id", "title", "description", "versions", "created_at", "updated_at"]


class StudentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Student
        fields = ["id", "institutional_id", "first_name", "last_name", "display_name", "created_at", "updated_at"]


class SubmissionTaskStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubmissionTaskState
        fields = ["id", "task_id", "status", "duration_seconds", "save_count", "modified_files_count", "metadata"]


class SubmissionEventSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = SubmissionEventSummary
        fields = ["event_type", "count"]


class SubmissionAgentSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = SubmissionAgentSummary
        fields = ["total_messages", "student_messages", "agent_messages", "providers"]


class ImportWarningSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImportWarning
        fields = ["id", "code", "message", "details", "created_at"]


class SubmissionListSerializer(serializers.ModelSerializer):
    student = StudentSerializer(read_only=True)
    activityVersion = ActivityVersionListSerializer(source="activity_version", read_only=True)
    courseGroup = CourseGroupSerializer(source="course_group", read_only=True)
    originalZipUrl = serializers.FileField(source="original_zip", read_only=True)
    originalZipName = serializers.SerializerMethodField()

    class Meta:
        model = Submission
        fields = [
            "id",
            "activityVersion",
            "courseGroup",
            "student",
            "name",
            "contribution_id",
            "checksum_sha256",
            "has_git",
            "event_count",
            "agent_interaction_count",
            "warning_count",
            "originalZipUrl",
            "originalZipName",
            "exported_at",
            "imported_at",
        ]

    def get_originalZipName(self, obj):
        if not obj.original_zip:
            return ""
        return obj.original_zip.name.rsplit("/", 1)[-1]


class SubmissionDetailSerializer(SubmissionListSerializer):
    task_states = SubmissionTaskStateSerializer(many=True, read_only=True)
    event_summaries = SubmissionEventSummarySerializer(many=True, read_only=True)
    agent_summary = SubmissionAgentSummarySerializer(read_only=True)
    warnings = ImportWarningSerializer(many=True, read_only=True)

    class Meta(SubmissionListSerializer.Meta):
        fields = SubmissionListSerializer.Meta.fields + [
            "activity_manifest",
            "activity_configuration",
            "state",
            "task_states",
            "event_summaries",
            "agent_summary",
            "warnings",
            "originalZipUrl",
        ]


class ZipImportSerializer(serializers.Serializer):
    zip = serializers.FileField()
    courseGroupId = serializers.IntegerField(required=False)
    activityVersionId = serializers.IntegerField(required=False)
    submissionName = serializers.CharField(required=False, allow_blank=True, max_length=240)
    name = serializers.CharField(required=False, allow_blank=True, max_length=240)
