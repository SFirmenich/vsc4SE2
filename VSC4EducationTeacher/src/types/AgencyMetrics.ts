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

export interface ObservableAgencyDimension {
  name: string;
  score: number;
  weight: number;
  evidence: string[];
}

export interface ObservableAgencyAssessment {
  score: number;
  level: "muy alta" | "alta" | "media" | "baja" | "insuficiente";
  confidence: "alta" | "media" | "limitada";
  dimensions: ObservableAgencyDimension[];
  strengths: string[];
  flags: string[];
}

export interface StudentAgencyMetrics {
  studentId: string;
  groups: AgencyMetricGroup[];
  observableAgency: ObservableAgencyAssessment;
}
