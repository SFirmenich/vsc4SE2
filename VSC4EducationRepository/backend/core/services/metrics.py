from collections import Counter

from core.models import ActivityVersion, CourseGroup, Submission, SubmissionTaskState


class ActivityMetricsService:
    def for_activity_version(self, activity_version: ActivityVersion, course_id=None, course_group_id=None) -> dict:
        submissions = Submission.objects.filter(activity_version=activity_version)
        if course_id:
            submissions = submissions.filter(course_group__course_id=course_id)
        if course_group_id:
            submissions = submissions.filter(course_group_id=course_group_id)
        total = submissions.count()
        task_ids = list(activity_version.tasks.values_list("task_id", flat=True))
        completed_by_task = {}
        for task_id in task_ids:
            completed = SubmissionTaskState.objects.filter(
                submission__in=submissions,
                task_id=task_id,
                status__in=["completed", "finished", "done"],
            ).count()
            completed_by_task[task_id] = {
                "completed": completed,
                "total": total,
                "ratio": completed / total if total else 0,
            }

        event_distribution = Counter()
        for submission in submissions.prefetch_related("event_summaries"):
            for summary in submission.event_summaries.all():
                event_distribution[summary.event_type] += summary.count

        return {
            "activityVersionId": activity_version.id,
            "submissions": total,
            "uniqueStudents": submissions.values("student_id").distinct().count(),
            "tasks": completed_by_task,
            "averageEvents": self._average([s.event_count for s in submissions]),
            "averageAgentInteractions": self._average([s.agent_interaction_count for s in submissions]),
            "withGitRatio": submissions.filter(has_git=True).count() / total if total else 0,
            "withAgentInteractionsRatio": submissions.filter(agent_interaction_count__gt=0).count() / total if total else 0,
            "eventDistribution": dict(event_distribution),
            "warningCount": sum(s.warning_count for s in submissions),
        }

    def comparison(self, activity_version: ActivityVersion) -> list[dict]:
        rows = []
        submissions = Submission.objects.filter(activity_version=activity_version).select_related("student", "course_group")
        for submission in submissions.prefetch_related("task_states"):
            rows.append({
                "submissionId": submission.id,
                "studentId": submission.student.institutional_id,
                "studentName": str(submission.student),
                "courseGroup": submission.course_group.name if submission.course_group else None,
                "eventCount": submission.event_count,
                "agentInteractionCount": submission.agent_interaction_count,
                "hasGit": submission.has_git,
                "warningCount": submission.warning_count,
                "tasks": [
                    {
                        "taskId": task.task_id,
                        "status": task.status,
                        "durationSeconds": task.duration_seconds,
                        "saveCount": task.save_count,
                        "modifiedFilesCount": task.modified_files_count,
                    }
                    for task in submission.task_states.all()
                ],
            })
        return rows

    def _average(self, values: list[int]) -> float:
        return sum(values) / len(values) if values else 0


class CourseGroupMetricsService:
    def for_course_group(self, course_group: CourseGroup) -> dict:
        submissions = Submission.objects.filter(course_group=course_group)
        return {
            "courseGroupId": course_group.id,
            "activities": course_group.activity_versions.count(),
            "submissions": submissions.count(),
            "uniqueStudents": submissions.values("student_id").distinct().count(),
            "averageEvents": ActivityMetricsService()._average([s.event_count for s in submissions]),
            "warningCount": sum(s.warning_count for s in submissions),
        }
