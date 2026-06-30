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
  contribution_id: string;
  event_count: number;
  agent_interaction_count: number;
  warning_count: number;
  has_git: boolean;
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
  originalZipUrl: string;
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
