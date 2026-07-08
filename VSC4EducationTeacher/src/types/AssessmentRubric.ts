export type AssessmentAgencyMode =
  | "none"
  | "weighted"
  | "modifier"
  | "cap"
  | "bonus";

export interface AssessmentCriterion {
  id: string;
  title?: string;
  description?: string;
  maxScore: number;
  allowsPartialCredit: boolean;
}

export interface AssessmentAgencyRule {
  metric: string;
  when: string;
  reason?: string;
  adjustment?: number;
  score?: number;
  cap?: number;
}

export interface AssessmentAgency {
  mode: AssessmentAgencyMode;
  maxScore?: number;
  maxAdjustment?: number;
  rules?: AssessmentAgencyRule[];
}

export interface AssessmentRubric {
  taskId?: string;
  maxScore: number;
  requiresTeacherReview?: boolean;
  criteria: AssessmentCriterion[];
  agency?: AssessmentAgency;
}
