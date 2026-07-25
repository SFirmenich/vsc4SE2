export type AnalysisChartKind = "bar" | "dot" | "category";

export type AnalysisPoint = {
  id: number;
  label: string;
  value: number | string;
};

export type AnalysisMetricSeries = {
  key: string;
  title: string;
  unit?: string | null;
  dimension: string;
  kind: AnalysisChartKind;
  points: AnalysisPoint[];
};
