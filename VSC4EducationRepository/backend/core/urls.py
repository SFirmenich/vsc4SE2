from django.urls import include, path
from rest_framework.routers import DefaultRouter

from core import views


router = DefaultRouter()
router.register("courses", views.CourseViewSet)
router.register("course-groups", views.CourseGroupViewSet)
router.register("activities", views.LearningActivityViewSet)
router.register("activity-versions", views.ActivityVersionViewSet)
router.register("students", views.StudentViewSet)
router.register("submissions", views.SubmissionViewSet)

urlpatterns = [
    path("", include(router.urls)),
    path("users/me/", views.me),
    path("integration/teacher/activity-zip/", views.teacher_activity_zip),
    path("integration/teacher/submission-zip/", views.teacher_submission_zip),
    path("integration/teacher/activities/", views.teacher_activities),
    path("integration/teacher/course-groups/", views.teacher_course_groups),
    path("integration/teacher/activity-versions/<int:pk>/submissions/", views.teacher_activity_submissions),
]
