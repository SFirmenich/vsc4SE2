export interface AgentInteraction {
  timestamp: string;
  actor: "student" | "agent";
  agent?: "chatGPT" | "claude" | "copilot";
  message: string;
  sessionId?: string;
  taskId?: string;
}
