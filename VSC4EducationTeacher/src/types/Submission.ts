import { ActivityManifest } from "./ActivityManifest";
import { Contribution } from "./Contribution";

export interface ImportedSubmission {
  id: string;
  sourceZip: string;
  rootPath: string;
  projectPath: string;
  metadataPath: string;
  manifest: ActivityManifest;
  contributions: Contribution[];
  hasGit: boolean;
  importedAt: string;
}
