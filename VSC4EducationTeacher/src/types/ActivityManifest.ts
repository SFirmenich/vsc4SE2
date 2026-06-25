import { ActivityTask } from "./ActivityTask";

export interface ActivityManifest {
  id: string;
  title: string;
  description?: string;
  version?: string;
  type?: "exercise" | "project";
  tasks: ActivityTask[];
}
