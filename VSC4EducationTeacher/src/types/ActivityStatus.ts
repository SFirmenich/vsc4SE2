import { ActivityManifest } from "./ActivityManifest";
import { Rubric } from "./Rubric";
import { ValidationResult } from "./Validation";

export interface ActivityFileStatus {
  path: string;
  kind: "manifest" | "task" | "theory" | "agent" | "rubric" | "assessment" | "starter";
  exists: boolean;
  referenced?: boolean;
  size?: number;
}

export interface ActivityTaskStatus {
  id: string;
  title: string;
  file?: string;
  fileExists: boolean;
  dependencies: string[];
}

export interface DiscoveredTaskStatus {
  id: string;
  title: string;
  file: string;
  number: number;
}

export interface ActivityStatus {
  root: string;
  initialized: boolean;
  manifest?: ActivityManifest;
  manifestError?: string;
  rubric?: Rubric;
  files: ActivityFileStatus[];
  tasks: ActivityTaskStatus[];
  discoveredTasks: DiscoveredTaskStatus[];
  nextTaskNumber: number;
  validation?: ValidationResult;
  counts: {
    tasks: number;
    theoryFiles: number;
    starterFiles: number;
    errors: number;
    warnings: number;
  };
}
