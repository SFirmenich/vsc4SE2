import type { SubmissionAnalysisRow } from "../../types";
import { t } from "../../i18n";
import { integrityLabel } from "../../lib/format";
import type { AnalysisChartKind, AnalysisMetricSeries, AnalysisPoint } from "./types";

const SUMMARY_ANALYSIS_METRICS: { key: string; title: string; unit?: string; kind?: AnalysisChartKind }[] = [
  { key: "activeMinutes", title: "Active time", unit: "min" },
  { key: "uniqueLinesTouched", title: "Unique lines changed" },
  { key: "filesModified", title: "Modified files" },
  { key: "fileChangeEvents", title: "File change events" },
  { key: "saves", title: "Saves" },
  { key: "tasksStarted", title: "Tasks started" },
  { key: "tasksCompleted", title: "Tasks completed" },
  { key: "agentInteractions", title: "Agent interactions" },
  { key: "studentAgentMessages", title: "Student messages to agent" },
  { key: "agentResponses", title: "Agent responses" },
  { key: "commits", title: "Commits" },
  { key: "heartbeatGaps", title: "Heartbeat gaps" },
  { key: "agencyScore", title: "Observable agency score", kind: "dot" },
];

export function buildAnalysisMetrics(rows: SubmissionAnalysisRow[]): AnalysisMetricSeries[] {
  const result: AnalysisMetricSeries[] = [];
  for (const metric of SUMMARY_ANALYSIS_METRICS) {
    const points = rows
      .map((row) => ({
        id: row.submissionId,
        label: submissionChartLabel(row),
        value: row.summary[metric.key],
      }))
      .filter((point): point is AnalysisPoint => typeof point.value === "number" && Number.isFinite(point.value));
    if (points.length) {
      result.push({
        key: `summary:${metric.key}`,
        title: metric.title,
        unit: metric.unit,
        dimension: "Observable summary",
        kind: metric.kind ?? inferNumericChartKind(metric.title, metric.unit),
        points,
      });
    }
  }

  result.push(
    categoricalMetric("integrityStatus", t("Integrity"), t("Submission control"), rows.map((row) => ({ id: row.submissionId, label: submissionChartLabel(row), value: integrityLabel(row.integrityStatus) }))),
    categoricalMetric("agencyLevel", t("Observable agency level"), t("Agency"), rows.map((row) => ({ id: row.submissionId, label: submissionChartLabel(row), value: row.agencyLevel }))),
  );

  const grouped = new Map<string, AnalysisMetricSeries>();
  for (const row of rows) {
    for (const group of row.agencyMetrics) {
      for (const metric of group.metrics) {
        const key = `agency:${metric.id}:${metric.name}`;
        const entry = grouped.get(key) ?? {
          key,
          title: metric.name,
          unit: metric.unit,
          dimension: metric.priority ? `Priority - ${group.dimension}` : group.dimension,
          kind: typeof metric.value === "number" ? inferNumericChartKind(metric.name, metric.unit) : "category",
          points: [],
        };
        if (typeof metric.value === "number" || typeof metric.value === "string") {
          entry.points.push({
            id: row.submissionId,
            label: submissionChartLabel(row),
            value: metric.value,
          });
        }
        grouped.set(key, entry);
      }
    }
  }

  return [...result, ...Array.from(grouped.values()).filter((metric) => metric.points.length > 0)];
}

export function submissionChartLabel(row: SubmissionAnalysisRow) {
  return row.submissionName || row.studentName || row.studentId;
}

function categoricalMetric(key: string, title: string, dimension: string, points: AnalysisPoint[]): AnalysisMetricSeries {
  return { key, title, dimension, kind: "category", points };
}

export function inferNumericChartKind(name: string, unit?: string | null): AnalysisChartKind {
  const normalized = `${name} ${unit ?? ""}`.toLowerCase();
  if (normalized.includes("%") || normalized.includes("ratio") || normalized.includes("proporcion") || normalized.includes("indice") || normalized.includes("score") || normalized.includes("puntaje")) {
    return "dot";
  }
  return "bar";
}

