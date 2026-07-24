export interface Course {
  id: number;
  name: string;
  code: string;
  description: string;
}

export interface CourseGroup {
  id: number;
  course: number;
  courseName: string;
  name: string;
  term: string;
}

export interface ActivityVersion {
  id: number;
  activity: number;
  activityId: string;
  version: string;
  title: string;
  description: string;
  checksum_sha256: string;
  courseGroups?: CourseGroup[];
  submissionCount: number;
}

export interface ActivityTask {
  id: number;
  task_id: string;
  title: string;
  description: string;
  file: string;
  order: number;
}

export interface ActivityVersionDetail extends ActivityVersion {
  manifest: Record<string, unknown>;
  tasks: ActivityTask[];
  course_groups: CourseGroup[];
  originalZipUrl: string;
}

export interface LearningActivity {
  id: number;
  activity_id: string;
  title: string;
  description: string;
  versions: ActivityVersion[];
}

export interface Student {
  id: number;
  institutional_id: string;
  display_name: string;
}

export interface Submission {
  id: number;
  activityVersion: ActivityVersion;
  courseGroup: CourseGroup | null;
  student: Student;
  name: string;
  contribution_id: string;
  event_count: number;
  agent_interaction_count: number;
  warning_count: number;
  has_git: boolean;
  originalZipUrl: string;
  originalZipName: string;
  imported_at: string;
}

export interface SubmissionTaskState {
  id: number;
  task_id: string;
  status: string;
  duration_seconds: number | null;
  save_count: number;
  modified_files_count: number;
  metadata: Record<string, unknown>;
}

export interface SubmissionEventSummary {
  event_type: string;
  count: number;
}

export interface ImportWarning {
  id: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface SubmissionDetail extends Submission {
  activity_manifest: Record<string, unknown>;
  activity_configuration: Record<string, unknown>;
  state: Record<string, unknown>;
  task_states: SubmissionTaskState[];
  event_summaries: SubmissionEventSummary[];
  agent_summary: {
    total_messages: number;
    student_messages: number;
    agent_messages: number;
    providers: string[];
  };
  warnings: ImportWarning[];
}

export interface SubmissionReviewSummary {
  studentId: string;
  tasksStarted: number;
  tasksCompleted: number;
  saves: number;
  commits: number;
  filesModified: number;
  sourceFilesModified: number;
  lineTouchCount: number;
  uniqueLinesTouched: number;
  fileChangeEvents: number;
  editBursts: number;
  activeMinutes: number;
  heartbeatGaps: number;
  agentInteractions: number;
  studentAgentMessages: number;
  agentResponses: number;
  activityByHour: { hour: string; count: number }[];
  linesByFile: { file: string; lines: number }[];
  agency: {
    score: number;
    level: string;
    positives: string[];
    concerns: string[];
  };
}

export interface AgencyMetric {
  id: number;
  priority: boolean;
  name: string;
  value: string | number;
  unit?: string | null;
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
  level: "very high" | "high" | "medium" | "low" | "insufficient";
  confidence: "high" | "medium" | "limited";
  dimensions: ObservableAgencyDimension[];
  strengths: string[];
  flags: string[];
}

export interface SubmissionReview {
  submissionId: number;
  studentId: string;
  contributionId: string;
  activityManifest: Record<string, unknown>;
  activityConfiguration: Record<string, unknown>;
  profile: Record<string, unknown>;
  state: Record<string, unknown>;
  summary: SubmissionReviewSummary;
  agencyMetrics: {
    studentId: string;
    groups: AgencyMetricGroup[];
    observableAgency: ObservableAgencyAssessment;
  };
  integrity: {
    status: "valid" | "invalid" | "incomplete" | "not_available";
    checkedEntries: number;
    firstInvalidLine?: number;
    message: string;
  };
  events: Record<string, unknown>[];
  eventParseErrors: { line: number; reason: string }[];
  agentInteractions: {
    timestamp: string;
    actor: "student" | "agent";
    agent?: string | null;
    message: string;
    sessionId?: string | null;
    taskId?: string | null;
  }[];
  agentInteractionErrors: string[];
}

export interface StatsSummary {
  count: number;
  avg: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
}

export interface ActivityDashboardMetric {
  id: number;
  name: string;
  unit?: string | null;
  priority: boolean;
  reliability: "direct" | "estimated" | "limited";
  stats: StatsSummary;
  valueCounts: Record<string, number>;
  nonNumericCount: number;
}

export interface ActivityReviewDashboard {
  activityVersionId: number;
  submissionCount: number;
  reviewedSubmissionCount: number;
  studentCount: number;
  summary: Record<string, StatsSummary>;
  agency: {
    score: StatsSummary;
    levels: Record<string, number>;
    topPositives: { label: string; count: number }[];
    topConcerns: { label: string; count: number }[];
  };
  integrity: Record<string, number>;
  agentUse: {
    withAgentInteractions: number;
    withAgentInteractionsRatio: number;
    studentMessages: StatsSummary;
    agentResponses: StatsSummary;
    totalInteractions: StatsSummary;
  };
  metricGroups: {
    dimension: string;
    metrics: ActivityDashboardMetric[];
  }[];
  warnings: {
    submissionId: number;
    studentId: string;
    code: string;
    message: string;
  }[];
}

export interface SubmissionAnalysisMetricValue {
  id: number;
  name: string;
  unit?: string | null;
  priority: boolean;
  reliability: "direct" | "estimated" | "limited";
  value: string | number;
}

export interface SubmissionAnalysisMetricGroup {
  dimension: string;
  metrics: SubmissionAnalysisMetricValue[];
}

export interface SubmissionAnalysisRow {
  submissionId: number;
  submissionName: string;
  studentId: string;
  studentName: string;
  courseGroup: string | null;
  importedAt: string;
  summary: Record<string, number | string | null>;
  agencyMetrics: SubmissionAnalysisMetricGroup[];
  integrityStatus: "valid" | "invalid" | "incomplete" | "not_available";
  agencyLevel: string;
  agencyScore: number | null;
}

export interface ActivitySubmissionAnalysis {
  activityVersionId: number;
  submissionCount: number;
  reviewedSubmissionCount: number;
  submissions: SubmissionAnalysisRow[];
  warnings: {
    submissionId: number;
    studentId: string;
    code: string;
    message: string;
  }[];
}

export interface Metrics {
  submissions: number;
  uniqueStudents: number;
  averageEvents: number;
  averageAgentInteractions: number;
  withGitRatio: number;
  withAgentInteractionsRatio: number;
  warningCount: number;
  tasks: Record<string, { completed: number; total: number; ratio: number }>;
  eventDistribution: Record<string, number>;
}
