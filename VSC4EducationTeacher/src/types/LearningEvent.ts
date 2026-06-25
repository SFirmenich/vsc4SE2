export interface LearningEvent {
  id?: string;
  timestamp?: string;
  type?: string;
  event?: string;
  taskId?: string;
  file?: string;
  data?: Record<string, unknown>;
  previousHash: string | null;
  hash: string;
  [key: string]: unknown;
}
