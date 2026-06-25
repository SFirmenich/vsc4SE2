export interface FeedbackEvidence {
  type: "commit" | "event" | "file" | "agent-interaction";
  reference: string;
}

export interface CriterionEvaluation {
  criterionId: string;
  level: number;
  score: number;
  comment?: string;
  evidence?: FeedbackEvidence[];
}

export interface SubmissionFeedback {
  submissionId: string;
  studentId: string;
  status: "pending" | "completed";
  updatedAt: string;
  evaluations: CriterionEvaluation[];
  generalComment?: string;
}
