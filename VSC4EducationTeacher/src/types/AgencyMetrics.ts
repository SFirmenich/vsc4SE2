export interface AgencyMetric {
  id: number;
  name: string;
  priority: boolean;
  value: string | number;
  unit?: string;
  detail: string;
  interpretation: string;
  evidenceCount: number;
  reliability: "direct" | "estimated" | "limited";
}

export interface AgencyMetricGroup {
  dimension: string;
  metrics: AgencyMetric[];
}

export interface StudentAgencyMetrics {
  studentId: string;
  groups: AgencyMetricGroup[];
}
