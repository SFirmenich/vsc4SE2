/**
 * Types for the "v2" agency metrics engine, implementing the schema specified in
 * .no_sync/metrics-future-work/metrics-new-approach.md (section 7 "Estructura de salida propuesta").
 *
 * This is purely additive: it does not replace, alter, or remove any of the v1
 * types in `AgencyMetrics.ts`. Both engines coexist and are shown side by side
 * in the review panels.
 */

export type AgencyReliabilityV2 = "direct" | "estimated" | "limited";

export type AgencyConfidenceV2 = "alta" | "media" | "limitada";

export type AgencySummaryLevelV2 =
  | "muy alta"
  | "alta"
  | "media"
  | "baja"
  | "insuficiente";

/**
 * One atomic metric (T1, C4, A1, S3, ...) as referenced throughout section 2 of the spec.
 * `value` is the headline number shown in `atoms` (a normalized 0-100 score when the
 * metric is `scored`, otherwise the raw/contextual value, e.g. a count or minutes).
 */
export interface AtomicMetricV2 {
  id: string;
  name: string;
  value: number;
  unit?: string;
  detail: string;
  /** Plain-language explanation of what this number means and how to read it (shown as "Reading" in the UI). */
  interpretation: string;
  reliability: AgencyReliabilityV2;
  /**
   * true when this atom feeds a weighted average (section 4); false when it is context/flag-only.
   * Also doubles as the UI's "Priority" badge flag, equivalent to v1's `AgencyMetric.priority`.
   */
  scored: boolean;
}

/** Common shape shared by the four indices described in section 5 of the spec. */
export interface AgencyIndexV2 {
  score: number;
  confidence: AgencyConfidenceV2;
  flags: string[];
  note?: string;
  evidence: AtomicMetricV2[];
}

/** Compromiso/Proceso adds named sub-dimension scores (Presencia, Intensidad, ...). */
export interface EngagementIndexV2 extends AgencyIndexV2 {
  subdimensions: Record<string, number>;
}

export interface StudentAgencyMetricsV2 {
  studentId: string;
  metricsSchemaVersion: "2.0.0";
  /** Flat id -> headline value map for every atomic metric computed (section 7 example). */
  atoms: Record<string, number>;
  traceability: AgencyIndexV2;
  engagement: EngagementIndexV2;
  authorship: AgencyIndexV2;
  agentSupport: AgencyIndexV2;
  /** Cross-interpretation flag from the Autoria x Soporte matrix (section 5.5/6); null when not triggered. */
  interpretationFlag: string | null;
  summary: {
    score: number;
    level: AgencySummaryLevelV2;
    flags: string[];
  };
}
