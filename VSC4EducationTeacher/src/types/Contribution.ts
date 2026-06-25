import { AgentInteraction } from "./AgentInteraction";
import { LearningEvent } from "./LearningEvent";

export interface Contribution {
  studentId: string;
  profile?: Record<string, unknown>;
  state?: Record<string, unknown>;
  events: LearningEvent[];
  eventParseErrors: number[];
  agentInteractions: AgentInteraction[];
  interactionErrors: string[];
}
