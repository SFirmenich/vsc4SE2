from django.contrib.auth.models import AnonymousUser
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from core.models import ActivityVersion, Course, CourseGroup, LearningActivity, Student, Submission
from core.serializers import (
    ActivityVersionDetailSerializer,
    ActivityVersionListSerializer,
    CourseGroupSerializer,
    CourseSerializer,
    ImportWarningSerializer,
    LearningActivitySerializer,
    StudentSerializer,
    SubmissionDetailSerializer,
    SubmissionListSerializer,
    ZipImportSerializer,
)
from core.services.activity_import import ActivityZipImportService
from core.services.activity_review_dashboard import ActivityReviewDashboardService
from core.services.metrics import ActivityMetricsService, CourseGroupMetricsService
from core.services.safe_zip import ZipValidationError
from core.services.submission_import import SubmissionZipImportService
from core.services.submission_review import SubmissionReviewService


def _owner(request):
    return None if isinstance(request.user, AnonymousUser) else request.user


def _course_group(course_group_id):
    if not course_group_id:
        return None
    return CourseGroup.objects.get(id=course_group_id)


class CourseViewSet(viewsets.ModelViewSet):
    queryset = Course.objects.all()
    serializer_class = CourseSerializer

    def perform_create(self, serializer):
        serializer.save(owner=_owner(self.request))

    @action(detail=True, methods=["get"])
    def groups(self, request, pk=None):
        serializer = CourseGroupSerializer(self.get_object().groups.all(), many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["get"], url_path="activity-versions")
    def activity_versions(self, request, pk=None):
        versions = ActivityVersion.objects.filter(course_groups__course=self.get_object()).select_related("activity").distinct()
        serializer = ActivityVersionListSerializer(versions, many=True, context={"request": request})
        return Response(serializer.data)

    @action(detail=True, methods=["get"])
    def submissions(self, request, pk=None):
        submissions = Submission.objects.filter(course_group__course=self.get_object()).select_related("student", "activity_version", "course_group")
        serializer = SubmissionListSerializer(submissions, many=True, context={"request": request})
        return Response(serializer.data)


class CourseGroupViewSet(viewsets.ModelViewSet):
    queryset = CourseGroup.objects.select_related("course").all()
    serializer_class = CourseGroupSerializer

    @action(detail=True, methods=["get"])
    def metrics(self, request, pk=None):
        return Response(CourseGroupMetricsService().for_course_group(self.get_object()))

    @action(detail=True, methods=["get"])
    def activities(self, request, pk=None):
        group = self.get_object()
        serializer = ActivityVersionListSerializer(group.activity_versions.all(), many=True, context={"request": request})
        return Response(serializer.data)

    @action(detail=True, methods=["get"])
    def submissions(self, request, pk=None):
        group = self.get_object()
        serializer = SubmissionListSerializer(group.submissions.all(), many=True, context={"request": request})
        return Response(serializer.data)


class LearningActivityViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = LearningActivity.objects.prefetch_related("versions").all()
    serializer_class = LearningActivitySerializer

    @action(detail=False, methods=["post"], url_path="import-zip")
    def import_zip(self, request):
        return import_activity_zip(request)

    @action(detail=True, methods=["get"])
    def versions(self, request, pk=None):
        serializer = ActivityVersionListSerializer(self.get_object().versions.all(), many=True, context={"request": request})
        return Response(serializer.data)


class ActivityVersionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ActivityVersion.objects.select_related("activity").prefetch_related("tasks", "course_groups").all()

    def get_serializer_class(self):
        return ActivityVersionDetailSerializer if self.action == "retrieve" else ActivityVersionListSerializer

    @action(detail=True, methods=["post"], url_path="assign-course-group")
    def assign_course_group(self, request, pk=None):
        group = CourseGroup.objects.get(id=request.data.get("courseGroupId"))
        activity_version = self.get_object()
        activity_version.course_groups.add(group)
        return Response(ActivityVersionDetailSerializer(activity_version, context={"request": request}).data)

    @action(detail=True, methods=["delete"], url_path=r"assign-course-group/(?P<course_group_id>[^/.]+)")
    def unassign_course_group(self, request, pk=None, course_group_id=None):
        activity_version = self.get_object()
        activity_version.course_groups.remove(CourseGroup.objects.get(id=course_group_id))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"])
    def submissions(self, request, pk=None):
        submissions = self.get_object().submissions.all()
        if request.query_params.get("courseId"):
            submissions = submissions.filter(course_group__course_id=request.query_params["courseId"])
        if request.query_params.get("courseGroupId"):
            submissions = submissions.filter(course_group_id=request.query_params["courseGroupId"])
        serializer = SubmissionListSerializer(submissions, many=True, context={"request": request})
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="submissions/import-zip")
    def import_submission_zip(self, request, pk=None):
        return import_submission_zip(request, activity_version=self.get_object())

    @action(detail=True, methods=["get"])
    def metrics(self, request, pk=None):
        return Response(ActivityMetricsService().for_activity_version(
            self.get_object(),
            course_id=request.query_params.get("courseId"),
            course_group_id=request.query_params.get("courseGroupId"),
        ))

    @action(detail=True, methods=["get"])
    def comparison(self, request, pk=None):
        return Response(ActivityMetricsService().comparison(self.get_object()))

    @action(detail=True, methods=["get"], url_path="review-dashboard")
    def review_dashboard(self, request, pk=None):
        return Response(ActivityReviewDashboardService().build(self.get_object()))

    @action(detail=True, methods=["get"], url_path="submission-analysis")
    def submission_analysis(self, request, pk=None):
        return Response(ActivityReviewDashboardService().build_analysis(
            self.get_object(),
            course_id=request.query_params.get("courseId"),
            course_group_id=request.query_params.get("courseGroupId"),
        ))


class StudentViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Student.objects.all()
    serializer_class = StudentSerializer

    @action(detail=True, methods=["get"])
    def submissions(self, request, pk=None):
        serializer = SubmissionListSerializer(self.get_object().submissions.all(), many=True, context={"request": request})
        return Response(serializer.data)


class SubmissionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Submission.objects.select_related("activity_version", "student", "course_group").all()

    def get_serializer_class(self):
        return SubmissionDetailSerializer if self.action == "retrieve" else SubmissionListSerializer

    @action(detail=False, methods=["post"], url_path="import-zip")
    def import_zip(self, request):
        activity_version = None
        if request.data.get("activityVersionId"):
            activity_version = ActivityVersion.objects.get(id=request.data.get("activityVersionId"))
        return import_submission_zip(request, activity_version=activity_version)

    @action(detail=True, methods=["get"])
    def tasks(self, request, pk=None):
        submission = self.get_object()
        return Response(SubmissionDetailSerializer(submission, context={"request": request}).data["task_states"])

    @action(detail=True, methods=["get"], url_path="events-summary")
    def events_summary(self, request, pk=None):
        submission = self.get_object()
        return Response(SubmissionDetailSerializer(submission, context={"request": request}).data["event_summaries"])

    @action(detail=True, methods=["get"], url_path="agent-summary")
    def agent_summary(self, request, pk=None):
        submission = self.get_object()
        return Response(SubmissionDetailSerializer(submission, context={"request": request}).data["agent_summary"])

    @action(detail=True, methods=["get"])
    def warnings(self, request, pk=None):
        serializer = ImportWarningSerializer(self.get_object().warnings.all(), many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["get"])
    def review(self, request, pk=None):
        try:
            return Response(SubmissionReviewService().build(self.get_object()))
        except ZipValidationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


def import_activity_zip(request):
    serializer = ZipImportSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        group = _course_group(serializer.validated_data.get("courseGroupId"))
        activity_version = ActivityZipImportService().import_zip(serializer.validated_data["zip"], owner=_owner(request), course_group=group)
    except ZipValidationError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ActivityVersionDetailSerializer(activity_version, context={"request": request}).data, status=status.HTTP_201_CREATED)


def import_submission_zip(request, activity_version=None):
    serializer = ZipImportSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        group = _course_group(serializer.validated_data.get("courseGroupId"))
        submission_name = serializer.validated_data.get("submissionName") or serializer.validated_data.get("name") or ""
        submission = SubmissionZipImportService().import_zip(
            serializer.validated_data["zip"],
            activity_version=activity_version,
            course_group=group,
            name=submission_name,
        )
    except ZipValidationError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(SubmissionDetailSerializer(submission, context={"request": request}).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def me(request):
    if isinstance(request.user, AnonymousUser):
        return Response({"id": None, "username": "local"})
    return Response({"id": request.user.id, "username": request.user.username})


@api_view(["POST"])
def teacher_activity_zip(request):
    return import_activity_zip(request)


@api_view(["POST"])
def teacher_submission_zip(request):
    activity_version = None
    if request.data.get("activityVersionId"):
        activity_version = ActivityVersion.objects.get(id=request.data.get("activityVersionId"))
    return import_submission_zip(request, activity_version=activity_version)


@api_view(["GET"])
def teacher_activities(request):
    serializer = ActivityVersionListSerializer(ActivityVersion.objects.select_related("activity").all(), many=True, context={"request": request})
    return Response(serializer.data)


@api_view(["GET"])
def teacher_course_groups(request):
    serializer = CourseGroupSerializer(CourseGroup.objects.select_related("course").all(), many=True)
    return Response(serializer.data)


@api_view(["GET"])
def teacher_activity_submissions(request, pk):
    version = ActivityVersion.objects.get(id=pk)
    serializer = SubmissionListSerializer(version.submissions.all(), many=True, context={"request": request})
    return Response(serializer.data)
