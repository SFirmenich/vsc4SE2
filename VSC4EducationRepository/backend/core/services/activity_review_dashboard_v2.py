"""Agregacion por actividad del motor de metricas v2.

Paralelo a `activity_review_dashboard.py` (v1), pero orientado a los cuatro
indices de `submission_review_v2.SubmissionReviewServiceV2` en vez de a las
seis dimensiones ponderadas de `observableAgency`. No importa nada privado
de los modulos v1; `_stats`/`_percentile` se duplican aqui (son pequenas) en
vez de reutilizar las de `ActivityReviewDashboardService`.
"""

from collections import Counter
from math import floor

from core.models import ActivityVersion
from core.services.safe_zip import ZipValidationError
from core.services.submission_review_v2 import SubmissionReviewServiceV2


class ActivityReviewDashboardServiceV2:
    def build(self, activity_version: ActivityVersion) -> dict:
        submissions = self._submissions(activity_version)
        reviews, warnings = self._reviews(submissions)

        return {
            "activityVersionId": activity_version.id,
            "metricsSchemaVersion": "2.0.0",
            "submissionCount": len(submissions),
            "reviewedSubmissionCount": len(reviews),
            "studentCount": len({submission.student_id for submission in submissions}),
            "traceability": self._index_stats(reviews, "traceability"),
            "engagement": self._index_stats(reviews, "engagement"),
            "authorship": self._index_stats(reviews, "authorship"),
            "agentSupport": self._index_stats(reviews, "agentSupport"),
            "summary": self._summary_stats(reviews),
            "interpretationFlagCount": len([review for review in reviews if review.get("interpretationFlag")]),
            "warnings": warnings,
        }

    def build_analysis(self, activity_version: ActivityVersion, course_id=None, course_group_id=None) -> dict:
        submissions = self._submissions(activity_version, course_id=course_id, course_group_id=course_group_id)
        reviews, warnings = self._reviews(submissions, keep_submission=True)

        rows = []
        for submission, review in reviews:
            rows.append(
                {
                    "submissionId": submission.id,
                    "submissionName": submission.name,
                    "studentId": submission.student.institutional_id,
                    "studentName": str(submission.student),
                    "courseGroup": submission.course_group.name if submission.course_group else None,
                    "importedAt": submission.imported_at.isoformat(),
                    "metricsSchemaVersion": review.get("metricsSchemaVersion", "2.0.0"),
                    "traceabilityScore": review["traceability"]["score"],
                    "engagementScore": review["engagement"]["score"],
                    "authorshipScore": review["authorship"]["score"],
                    "agentSupportScore": review["agentSupport"]["score"],
                    "summaryScore": review["summary"]["score"],
                    "summaryLevel": review["summary"]["level"],
                    "interpretationFlag": review.get("interpretationFlag"),
                    "atoms": review["atoms"],
                }
            )

        return {
            "activityVersionId": activity_version.id,
            "metricsSchemaVersion": "2.0.0",
            "submissionCount": len(submissions),
            "reviewedSubmissionCount": len(rows),
            "submissions": rows,
            "warnings": warnings,
        }

    def _reviews(self, submissions, keep_submission: bool = False):
        review_service = SubmissionReviewServiceV2()
        reviews = []
        warnings = []
        for submission in submissions:
            try:
                review = review_service.build(submission)
            except (OSError, ZipValidationError, ValueError) as exc:
                warnings.append(
                    {
                        "submissionId": submission.id,
                        "studentId": submission.student.institutional_id,
                        "code": "review_unavailable",
                        "message": str(exc),
                    }
                )
                continue
            reviews.append((submission, review) if keep_submission else review)
        return reviews, warnings

    def _submissions(self, activity_version: ActivityVersion, course_id=None, course_group_id=None):
        submissions = activity_version.submissions.select_related("student", "course_group").all()
        if course_id:
            submissions = submissions.filter(course_group__course_id=course_id)
        if course_group_id:
            submissions = submissions.filter(course_group_id=course_group_id)
        return list(submissions)

    def _index_stats(self, reviews: list[dict], index_key: str) -> dict:
        scores = [review[index_key]["score"] for review in reviews]
        confidences = Counter(str(review[index_key].get("confidence", "unknown")) for review in reviews)
        flags = Counter()
        for review in reviews:
            flags.update(review[index_key].get("flags") or [])
        return {
            "score": self._stats(scores),
            "confidenceLevels": dict(confidences),
            "topFlags": self._top_counts(flags),
        }

    def _summary_stats(self, reviews: list[dict]) -> dict:
        scores = [review["summary"]["score"] for review in reviews]
        levels = Counter(str(review["summary"].get("level", "unknown")) for review in reviews)
        return {
            "score": self._stats(scores),
            "levels": dict(levels),
        }

    def _stats(self, raw_values) -> dict:
        values = sorted(
            float(value)
            for value in raw_values
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        )
        if not values:
            return {"count": 0, "avg": 0, "min": 0, "p25": 0, "median": 0, "p75": 0, "p90": 0, "max": 0}
        return {
            "count": len(values),
            "avg": round(sum(values) / len(values), 2),
            "min": self._clean(values[0]),
            "p25": self._percentile(values, 25),
            "median": self._percentile(values, 50),
            "p75": self._percentile(values, 75),
            "p90": self._percentile(values, 90),
            "max": self._clean(values[-1]),
        }

    def _percentile(self, values: list[float], percentile: int):
        if len(values) == 1:
            return self._clean(values[0])
        position = (len(values) - 1) * percentile / 100
        lower = floor(position)
        upper = min(lower + 1, len(values) - 1)
        if lower == upper:
            return self._clean(values[lower])
        weight = position - lower
        return self._clean(values[lower] * (1 - weight) + values[upper] * weight)

    def _clean(self, value: float):
        rounded = round(value, 2)
        return int(rounded) if rounded == int(rounded) else rounded

    def _top_counts(self, counter: Counter) -> list[dict]:
        return [{"label": label, "count": count} for label, count in counter.most_common(8)]
