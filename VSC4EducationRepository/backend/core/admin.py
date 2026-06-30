from django.contrib import admin

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


admin.site.register(Course)
admin.site.register(CourseGroup)
admin.site.register(LearningActivity)
admin.site.register(ActivityVersion)
admin.site.register(ActivityTask)
admin.site.register(Student)
admin.site.register(Submission)
admin.site.register(SubmissionTaskState)
admin.site.register(SubmissionEventSummary)
admin.site.register(SubmissionAgentSummary)
admin.site.register(ImportWarning)
