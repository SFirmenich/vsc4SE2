from collections import Counter, defaultdict
from math import floor

from core.models import ActivityVersion
from core.services.safe_zip import ZipValidationError
from core.services.submission_review import SubmissionReviewService


SUMMARY_NUMERIC_KEYS = [
    "tasksStarted",
    "tasksCompleted",
    "saves",
    "commits",
    "filesModified",
    "sourceFilesModified",
    "lineTouchCount",
    "uniqueLinesTouched",
    "fileChangeEvents",
    "editBursts",
    "activeMinutes",
    "heartbeatGaps",
    "agentInteractions",
    "studentAgentMessages",
    "agentResponses",
]


class ActivityReviewDashboardService:
    def build(self, activity_version: ActivityVersion) -> dict:
        submissions = list(
            activity_version.submissions.select_related("student", "course_group").all()
        )
        reviews = []
        warnings = []
        review_service = SubmissionReviewService()

        for submission in submissions:
            try:
                reviews.append(review_service.build(submission))
            except (OSError, ZipValidationError, ValueError) as exc:
                warnings.append(
                    {
                        "submissionId": submission.id,
                        "studentId": submission.student.institutional_id,
                        "code": "review_unavailable",
                        "message": str(exc),
                    }
                )

        return {
            "activityVersionId": activity_version.id,
            "submissionCount": len(submissions),
            "reviewedSubmissionCount": len(reviews),
            "studentCount": len({submission.student_id for submission in submissions}),
            "summary": self._summary_stats(reviews),
            "agency": self._agency_stats(reviews),
            "integrity": self._integrity_stats(reviews),
            "agentUse": self._agent_stats(reviews),
            "metricGroups": self._metric_group_stats(reviews),
            "warnings": warnings,
        }

    def _summary_stats(self, reviews: list[dict]) -> dict:
        return {
            key: self._stats([review["summary"].get(key) for review in reviews])
            for key in SUMMARY_NUMERIC_KEYS
        }

    def _agency_stats(self, reviews: list[dict]) -> dict:
        scores = [review["summary"].get("agency", {}).get("score") for review in reviews]
        levels = Counter(
            str(review["summary"].get("agency", {}).get("level", "unknown"))
            for review in reviews
        )
        positives = Counter()
        concerns = Counter()
        for review in reviews:
            agency = review["summary"].get("agency", {})
            positives.update(agency.get("positives") or [])
            concerns.update(agency.get("concerns") or [])
        return {
            "score": self._stats(scores),
            "levels": dict(levels),
            "topPositives": self._top_counts(positives),
            "topConcerns": self._top_counts(concerns),
        }

    def _integrity_stats(self, reviews: list[dict]) -> dict:
        return dict(Counter(review["integrity"].get("status", "not_available") for review in reviews))

    def _agent_stats(self, reviews: list[dict]) -> dict:
        with_agent = [review for review in reviews if review["summary"].get("agentInteractions", 0) > 0]
        return {
            "withAgentInteractions": len(with_agent),
            "withAgentInteractionsRatio": len(with_agent) / len(reviews) if reviews else 0,
            "studentMessages": self._stats([review["summary"].get("studentAgentMessages") for review in reviews]),
            "agentResponses": self._stats([review["summary"].get("agentResponses") for review in reviews]),
            "totalInteractions": self._stats([review["summary"].get("agentInteractions") for review in reviews]),
        }

    def _metric_group_stats(self, reviews: list[dict]) -> list[dict]:
        grouped: dict[str, dict[int, dict]] = defaultdict(dict)
        for review in reviews:
            for group in review["agencyMetrics"].get("groups", []):
                dimension = group.get("dimension", "Sin dimension")
                for metric in group.get("metrics", []):
                    metric_id = metric.get("id")
                    if not isinstance(metric_id, int):
                        continue
                    entry = grouped[dimension].setdefault(
                        metric_id,
                        {
                            "id": metric_id,
                            "name": metric.get("name", ""),
                            "unit": metric.get("unit"),
                            "priority": bool(metric.get("priority")),
                            "reliability": metric.get("reliability", "limited"),
                            "values": [],
                            "valueCounts": Counter(),
                            "nonNumericCount": 0,
                        },
                    )
                    value = metric.get("value")
                    if isinstance(value, (int, float)) and not isinstance(value, bool):
                        entry["values"].append(value)
                    else:
                        entry["nonNumericCount"] += 1
                        entry["valueCounts"].update([str(value)])

        output = []
        for dimension, metrics in grouped.items():
            output.append(
                {
                    "dimension": dimension,
                    "metrics": [
                        {
                            "id": metric["id"],
                            "name": metric["name"],
                            "unit": metric["unit"],
                            "priority": metric["priority"],
                            "reliability": metric["reliability"],
                            "stats": self._stats(metric["values"]),
                            "valueCounts": dict(metric["valueCounts"]),
                            "nonNumericCount": metric["nonNumericCount"],
                        }
                        for metric in sorted(metrics.values(), key=lambda item: item["id"])
                    ],
                }
            )
        return output

    def _stats(self, raw_values) -> dict:
        values = sorted(
            float(value)
            for value in raw_values
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        )
        if not values:
            return {
                "count": 0,
                "avg": 0,
                "min": 0,
                "p25": 0,
                "median": 0,
                "p75": 0,
                "p90": 0,
                "max": 0,
            }
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
