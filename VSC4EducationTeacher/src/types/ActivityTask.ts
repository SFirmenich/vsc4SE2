export type EvidenceType =
  | "source_changes"
  | "task_events"
  | "git_commits"
  | "agent_interactions"
  | string;

export interface ActivityTask {
  id: string;
  title: string;
  description?: string;
  file?: string;
  dependencies?: string[];
  acceptanceCriteria?: string[];
  expectedEvidence?: EvidenceType[];
}
