import type { SubmissionAnalysisV2Row } from "../../types";
import { t } from "../../i18n";
import type { AnalysisChartKind, AnalysisMetricSeries, AnalysisPoint } from "../analysis/types";

const INDEX_METRICS: { key: string; title: string; getValue: (row: SubmissionAnalysisV2Row) => number }[] = [
  { key: "traceabilityScore", title: "Traceability score", getValue: (row) => row.traceabilityScore },
  { key: "engagementScore", title: "Engagement score", getValue: (row) => row.engagementScore },
  { key: "authorshipScore", title: "Authorship score", getValue: (row) => row.authorshipScore },
  { key: "agentSupportScore", title: "Agent support score", getValue: (row) => row.agentSupportScore },
  { key: "summaryScore", title: "Summary score", getValue: (row) => row.summaryScore },
];

const ATOM_DIMENSIONS: { prefix: string; label: string }[] = [
  { prefix: "T", label: "Traceability atoms" },
  { prefix: "C", label: "Engagement atoms" },
  { prefix: "A", label: "Authorship atoms" },
  { prefix: "S", label: "Agent support atoms" },
];

export function submissionV2ChartLabel(row: SubmissionAnalysisV2Row): string {
  return row.submissionName || row.studentName || row.studentId;
}

export function buildAnalysisMetricsV2(rows: SubmissionAnalysisV2Row[]): AnalysisMetricSeries[] {
  const result: AnalysisMetricSeries[] = [];

  for (const metric of INDEX_METRICS) {
    const points: AnalysisPoint[] = rows
      .map((row) => ({ id: row.submissionId, label: submissionV2ChartLabel(row), value: metric.getValue(row) }))
      .filter((point) => Number.isFinite(point.value));
    if (points.length) {
      result.push({ key: `index:${metric.key}`, title: metric.title, dimension: "Executive indices", kind: "dot", points });
    }
  }

  const levelPoints = rows.map((row) => ({ id: row.submissionId, label: submissionV2ChartLabel(row), value: row.summaryLevel }));
  if (levelPoints.length) {
    result.push({ key: "summaryLevel", title: t("Summary level"), dimension: t("Executive indices"), kind: "category", points: levelPoints });
  }

  const grouped = new Map<string, AnalysisMetricSeries>();
  for (const row of rows) {
    for (const [atomId, value] of Object.entries(row.atoms ?? {})) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        continue;
      }
      const dimension = ATOM_DIMENSIONS.find((entry) => atomId.startsWith(entry.prefix))?.label ?? "Other atoms";
      const key = `atom:${atomId}`;
      const entry: AnalysisMetricSeries = grouped.get(key) ?? {
        key,
        title: atomId,
        dimension,
        kind: inferAtomChartKind(atomId),
        points: [],
      };
      entry.points.push({ id: row.submissionId, label: submissionV2ChartLabel(row), value });
      grouped.set(key, entry);
    }
  }

  return [...result, ...Array.from(grouped.values()).filter((metric) => metric.points.length > 0)];
}

function inferAtomChartKind(_atomId: string): AnalysisChartKind {
  return "bar";
}
