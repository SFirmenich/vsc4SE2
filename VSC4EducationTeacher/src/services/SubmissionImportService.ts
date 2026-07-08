import { promises as fs } from "fs";
import * as path from "path";
import { ActivityManifest } from "../types/ActivityManifest";
import { ImportedSubmission } from "../types/Submission";
import { createId } from "../utils/crypto";
import { pathExists, readJson, writeJson } from "../utils/fs";
import { SubmissionReviewService } from "./SubmissionReviewService";
import { ZipService } from "./ZipService";

export class SubmissionImportService {
  constructor(
    private readonly zip = new ZipService(),
    private readonly review = new SubmissionReviewService()
  ) {}

  async import(zipPath: string, storageRoot: string): Promise<ImportedSubmission> {
    const id = createId();
    const rootPath = path.join(storageRoot, "submissions", id);
    return this.importAtRoot(zipPath, id, rootPath);
  }

  async importToDirectory(
    zipPath: string,
    destinationRoot: string
  ): Promise<ImportedSubmission> {
    const id = createId();
    const zipName = path.basename(zipPath, path.extname(zipPath));
    const safeName = zipName.replace(/[^a-zA-Z0-9._-]/g, "-") || "submission";
    const rootPath = path.join(destinationRoot, `${safeName}-${id}`);
    return this.importAtRoot(zipPath, id, rootPath);
  }

  private async importAtRoot(
    zipPath: string,
    id: string,
    rootPath: string
  ): Promise<ImportedSubmission> {
    await fs.mkdir(rootPath, { recursive: true });
    await this.zip.extractSafe(zipPath, rootPath);
    const metadataPath = await this.findMetadata(rootPath);
    if (!metadataPath) {
      throw new Error(
        "Submission does not contain .vsc4education/activity-manifest.json"
      );
    }
    const projectPath = path.dirname(metadataPath);
    const manifest = await readJson<ActivityManifest>(
      path.join(metadataPath, "activity-manifest.json")
    );
    const submission: ImportedSubmission = {
      id,
      sourceZip: zipPath,
      rootPath,
      projectPath,
      metadataPath,
      manifest,
      contributions: await this.review.readContributions(metadataPath),
      hasGit: await pathExists(path.join(projectPath, ".git")),
      importedAt: new Date().toISOString()
    };
    await writeJson(path.join(rootPath, "submission.json"), submission);
    return submission;
  }

  private async findMetadata(current: string): Promise<string | undefined> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const full = path.join(current, entry.name);
      if (
        entry.name === ".vsc4education" &&
        (await pathExists(path.join(full, "activity-manifest.json")))
      ) {
        return full;
      }
      const nested = await this.findMetadata(full);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }
}
