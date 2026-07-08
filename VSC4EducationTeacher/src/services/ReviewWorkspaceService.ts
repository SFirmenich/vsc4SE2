import { promises as fs } from "fs";
import * as path from "path";
import { ImportedSubmission } from "../types/Submission";
import { pathExists, readJson } from "../utils/fs";
import { ZipService } from "./ZipService";
import { SubmissionImportService } from "./SubmissionImportService";

export interface ReviewWorkspaceStatus {
  root: string;
  activityRoot: string;
  submissionsRoot: string;
  initialized: boolean;
  activityImported: boolean;
  submissions: ImportedSubmissionSummary[];
}

export interface ImportedSubmissionSummary {
  id: string;
  label: string;
  rootPath: string;
  manifestTitle?: string;
  importedAt?: string;
}

export class ReviewWorkspaceService {
  constructor(
    private readonly zip = new ZipService(),
    private readonly importer = new SubmissionImportService()
  ) {}

  activityRoot(root: string): string {
    return path.join(root, "learning-activity-definition");
  }

  submissionsRoot(root: string): string {
    return path.join(root, "submissions");
  }

  async initialize(root: string): Promise<void> {
    await fs.mkdir(this.activityRoot(root), { recursive: true });
    await fs.mkdir(this.submissionsRoot(root), { recursive: true });
  }

  async status(root: string): Promise<ReviewWorkspaceStatus> {
    const activityRoot = this.activityRoot(root);
    const submissionsRoot = this.submissionsRoot(root);
    const initialized =
      (await pathExists(activityRoot)) && (await pathExists(submissionsRoot));
    return {
      root,
      activityRoot,
      submissionsRoot,
      initialized,
      activityImported: await pathExists(path.join(activityRoot, "manifest.json")),
      submissions: initialized ? await this.listSubmissions(root) : []
    };
  }

  async importActivityPackage(zipPath: string, root: string): Promise<void> {
    await this.initialize(root);
    const activityRoot = this.activityRoot(root);
    const entries = await fs.readdir(activityRoot);
    if (entries.length) {
      throw new Error("learning-activity-definition is not empty");
    }
    await this.zip.extractSafe(zipPath, activityRoot);
    await this.flattenSingleContainer(activityRoot, "manifest.json");
    if (!(await pathExists(path.join(activityRoot, "manifest.json")))) {
      throw new Error("Teacher activity package does not contain manifest.json");
    }
  }

  async importSubmissionPackage(
    zipPath: string,
    root: string
  ): Promise<ImportedSubmission> {
    await this.initialize(root);
    return this.importer.importToDirectory(zipPath, this.submissionsRoot(root));
  }

  async readSubmission(rootPath: string): Promise<ImportedSubmission> {
    return readJson<ImportedSubmission>(path.join(rootPath, "submission.json"));
  }

  private async listSubmissions(
    root: string
  ): Promise<ImportedSubmissionSummary[]> {
    const submissionsRoot = this.submissionsRoot(root);
    if (!(await pathExists(submissionsRoot))) return [];
    const output: ImportedSubmissionSummary[] = [];
    for (const entry of await fs.readdir(submissionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rootPath = path.join(submissionsRoot, entry.name);
      const metadataPath = path.join(rootPath, "submission.json");
      if (!(await pathExists(metadataPath))) continue;
      try {
        const submission = await readJson<ImportedSubmission>(metadataPath);
        output.push({
          id: submission.id,
          label: entry.name,
          rootPath,
          manifestTitle: submission.manifest.title,
          importedAt: submission.importedAt
        });
      } catch {
        output.push({ id: entry.name, label: entry.name, rootPath });
      }
    }
    return output.sort((left, right) => left.label.localeCompare(right.label));
  }

  private async flattenSingleContainer(
    root: string,
    requiredFile: string
  ): Promise<void> {
    if (await pathExists(path.join(root, requiredFile))) return;
    const entries = await fs.readdir(root, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());
    if (entries.length !== 1 || directories.length !== 1) return;
    const container = path.join(root, directories[0].name);
    if (!(await pathExists(path.join(container, requiredFile)))) return;
    const children = await fs.readdir(container);
    for (const child of children) {
      await fs.rename(path.join(container, child), path.join(root, child));
    }
    await fs.rmdir(container);
  }
}
