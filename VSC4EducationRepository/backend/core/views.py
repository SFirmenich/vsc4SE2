from django.contrib.auth.models import AnonymousUser
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from core.models import ActivityVersion, Course, CourseGroup, EventIngestionSession, LearningActivity, Student, Submission
from core.serializers import (
    ActivityDraftRegisterSerializer,
    ActivityVersionDetailSerializer,
    ActivityVersionListSerializer,
    CourseGroupSerializer,
    CourseSerializer,
    EventIngestionSessionCreateSerializer,
    EventIngestionTokenCreateSerializer,
    EventReceiptBatchSerializer,
    EventReceiptSerializer,
    ImportWarningSerializer,
    LearningActivitySerializer,
    StudentSerializer,
    SubmissionDetailSerializer,
    SubmissionListSerializer,
    ZipImportSerializer,
)
from core.services.activity_import import ActivityZipImportService
from core.services.activity_review_dashboard import ActivityReviewDashboardService
from core.services.activity_review_dashboard_v2 import ActivityReviewDashboardServiceV2
from core.services.event_receipts import (
    authenticate_ingestion_token,
    authenticate_session,
    create_or_get_session,
    create_receipts,
    issue_ingestion_token,
    public_key_fingerprint,
    public_signing_key,
    resolve_activity_version,
)
from core.services.metrics import ActivityMetricsService, CourseGroupMetricsService
from core.services.safe_zip import ZipValidationError
from core.services.submission_import import SubmissionZipImportService
from core.services.submission_review import SubmissionReviewService
from core.services.submission_review_v2 import SubmissionReviewServiceV2


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

    @action(detail=False, methods=["post"], url_path="register-draft")
    def register_draft(self, request):
        serializer = ActivityDraftRegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        group = _course_group(data.get("courseGroupId"))
        activity, _ = LearningActivity.objects.update_or_create(
            activity_id=data["activityId"],
            defaults={
                "owner": _owner(request),
                "title": data["title"],
                "description": data.get("description", ""),
            },
        )
        manifest = {
            "id": data["activityId"],
            "title": data["title"],
            "description": data.get("description", ""),
            "version": data["version"],
            "tasks": [],
        }
        activity_version, created = ActivityVersion.objects.get_or_create(
            activity=activity,
            version=data["version"],
            defaults={
                "title": data["title"],
                "description": data.get("description", ""),
                "manifest": manifest,
                "status": ActivityVersion.STATUS_DRAFT,
            },
        )
        if activity_version.status == ActivityVersion.STATUS_DRAFT:
            activity_version.title = data["title"]
            activity_version.description = data.get("description", "")
            activity_version.manifest = {
                **(activity_version.manifest or {}),
                **manifest,
            }
            activity_version.save()
        if group:
            activity_version.course_groups.add(group)
        response_status = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(
            ActivityVersionDetailSerializer(activity_version, context={"request": request}).data,
            status=response_status,
        )

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

    @action(detail=True, methods=["get"], url_path="review-dashboard-v2")
    def review_dashboard_v2(self, request, pk=None):
        return Response(ActivityReviewDashboardServiceV2().build(self.get_object()))

    @action(detail=True, methods=["get"], url_path="submission-analysis-v2")
    def submission_analysis_v2(self, request, pk=None):
        return Response(ActivityReviewDashboardServiceV2().build_analysis(
            self.get_object(),
            course_id=request.query_params.get("courseId"),
            course_group_id=request.query_params.get("courseGroupId"),
        ))

    @action(detail=True, methods=["get"], url_path="event-receipts")
    def event_receipts(self, request, pk=None):
        activity_version = self.get_object()
        sessions = EventIngestionSession.objects.filter(activity_version=activity_version).select_related("student", "course_group").prefetch_related("receipts")
        if request.query_params.get("courseGroupId"):
            sessions = sessions.filter(course_group_id=request.query_params["courseGroupId"])
        payload = []
        total_receipts = 0
        for session in sessions:
            receipts = list(session.receipts.all())
            total_receipts += len(receipts)
            payload.append({
                "id": session.id,
                "studentId": session.student.institutional_id,
                "studentName": session.student.display_name,
                "contributionId": session.contribution_id,
                "clientSessionId": session.client_session_id,
                "courseGroup": session.course_group.name if session.course_group else None,
                "startedAt": session.started_at,
                "closedAt": session.closed_at,
                "lastEventHash": session.last_event_hash,
                "receiptCount": len(receipts),
                "receipts": EventReceiptSerializer(receipts, many=True).data,
            })
        return Response({
            "activityVersionId": activity_version.id,
            "sessionCount": len(payload),
            "receiptCount": total_receipts,
            "sessions": payload,
        })

    @action(detail=True, methods=["post"], url_path="event-ingestion-token")
    def event_ingestion_token(self, request, pk=None):
        serializer = EventIngestionTokenCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        group = _course_group(serializer.validated_data.get("courseGroupId"))
        token_model, token = issue_ingestion_token(
            self.get_object(),
            course_group=group,
            name=serializer.validated_data.get("name") or "",
        )
        public_key = public_signing_key()
        activity_version = token_model.activity_version
        base_url = request.build_absolute_uri("/").rstrip("/")
        public_signing_key_url = request.build_absolute_uri("/api/integration/student/event-signing-key/")
        event_server = {
            "enabled": True,
            "baseUrl": base_url,
            "activityVersionId": activity_version.id,
            "ingestionToken": token,
            "publicSigningKeyUrl": public_signing_key_url,
            "expectedSigningKeyId": public_key["kid"],
            "expectedPublicKeySha256": public_key_fingerprint(public_key),
            "publicSigningKey": public_key,
            "requireReceipts": False,
        }
        manifest = activity_version.manifest or {}
        manifest["repository"] = {
            **(manifest.get("repository") or {}),
            "eventServer": event_server,
        }
        activity_version.manifest = manifest
        activity_version.save(update_fields=["manifest", "updated_at"])
        return Response({
            "id": token_model.id,
            "token": token,
            "activityId": activity_version.activity.activity_id,
            "version": activity_version.version,
            "courseGroupId": token_model.course_group_id,
            "publicSigningKey": public_key,
            "expectedSigningKeyId": public_key["kid"],
            "expectedPublicKeySha256": public_key_fingerprint(public_key),
            "createdAt": token_model.created_at,
        }, status=status.HTTP_201_CREATED)


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

    @action(detail=True, methods=["get"], url_path="review-v2")
    def review_v2(self, request, pk=None):
        try:
            return Response(SubmissionReviewServiceV2().build(self.get_object()))
        except ZipValidationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["get"], url_path="event-sessions")
    def event_sessions(self, request, pk=None):
        submission = self.get_object()
        sessions = EventIngestionSession.objects.filter(
            activity_version=submission.activity_version,
            student=submission.student,
            contribution_id=submission.contribution_id,
        ).prefetch_related("receipts")
        payload = [{
            "id": session.id,
            "clientSessionId": session.client_session_id,
            "courseGroup": session.course_group.name if session.course_group else None,
            "startedAt": session.started_at,
            "closedAt": session.closed_at,
            "lastEventHash": session.last_event_hash,
            "receiptCount": session.receipts.count(),
        } for session in sessions]
        return Response({
            "submissionId": submission.id,
            "sessionCount": len(payload),
            "sessions": payload,
        })


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


def _bearer_or_header(request, header_name):
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.headers.get(header_name, "")


@api_view(["GET"])
def student_event_signing_key(request):
    public_key = public_signing_key()
    return Response({
        "publicSigningKey": public_key,
        "signingKeyId": public_key["kid"],
        "publicKeySha256": public_key_fingerprint(public_key),
    })


@api_view(["POST"])
def student_event_session(request):
    serializer = EventIngestionSessionCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        activity_version = resolve_activity_version(data["activityId"], data.get("version") or "")
        ingestion_token = authenticate_ingestion_token(
            _bearer_or_header(request, "X-VSC4E-Ingestion-Token"),
            activity_version,
        )
        session, session_token = create_or_get_session(data, ingestion_token)
    except ZipValidationError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    payload = {
        "sessionId": session.id,
        "sessionToken": session_token,
        "serverStartedAt": session.started_at,
        "activityId": session.activity_version.activity.activity_id,
        "version": session.activity_version.version,
        "studentId": session.student.institutional_id,
        "contributionId": session.contribution_id,
    }
    if not session_token:
        payload["detail"] = "Session already exists; continue using the original session token."
    return Response(payload, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def student_event_receipts(request, pk):
    serializer = EventReceiptBatchSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        session = EventIngestionSession.objects.select_related("activity_version", "activity_version__activity", "student").get(id=pk)
        authenticate_session(_bearer_or_header(request, "X-VSC4E-Session-Token"), session)
        receipts = create_receipts(session, serializer.validated_data["events"])
    except (EventIngestionSession.DoesNotExist, ZipValidationError) as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response({"receipts": EventReceiptSerializer(receipts, many=True).data}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def student_event_session_close(request, pk):
    try:
        session = EventIngestionSession.objects.get(id=pk)
        authenticate_session(_bearer_or_header(request, "X-VSC4E-Session-Token"), session)
        session.closed_at = timezone.now()
        session.save(update_fields=["closed_at"])
    except (EventIngestionSession.DoesNotExist, ZipValidationError) as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(status=status.HTTP_204_NO_CONTENT)
