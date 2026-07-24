import { promises as fs } from "fs";
import * as path from "path";
import { listFiles, writeJson } from "../utils/fs";
import { sha256 } from "../utils/crypto";
import { ActivityValidationService } from "./ActivityValidationService";
import { ZipService } from "./ZipService";
import { EvidenceCryptoService } from "./EvidenceCryptoService";

export class ActivityPackageService {
  constructor(
    private readonly validation = new ActivityValidationService(),
    private readonly zip = new ZipService(),
    private readonly evidence = new EvidenceCryptoService()
  ) {}

  async export(
    activityRoot: string,
    destination: string,
    includeHashes = true
  ): Promise<void> {
    const result = await this.validation.validate(activityRoot);
    if (!result.valid) {
      throw new Error(
        `Activity has validation errors: ${result.errors
          .map((issue) => issue.message)
          .join("; ")}`
      );
    }
    await this.evidence.ensureKeyPair(activityRoot);
    if (includeHashes) {
      const hashes: Record<string, string> = {};
      for (const file of await listFiles(activityRoot)) {
        const relative = path.relative(activityRoot, file).replace(/\\/g, "/");
        if (
          relative === "signatures/hashes.json" ||
          relative === "AGENTS.md" ||
          relative.startsWith("assessment/") ||
          relative.startsWith("resources/") ||
          relative.startsWith("rubrics/") ||
          relative.startsWith("teacher-private/") ||
          relative.startsWith("imports/") ||
          relative.startsWith(".git/") ||
          relative.startsWith("node_modules/")
        ) {
          continue;
        }
        hashes[relative] = sha256(await fs.readFile(file));
      }
      await writeJson(path.join(activityRoot, "signatures", "hashes.json"), {
        algorithm: "sha256",
        signed: false,
        files: hashes
      });
    }
    await this.zip.createFromDirectory(
      activityRoot,
      destination,
      new Set(["node_modules", ".git", "dist", "out"]),
      new Set(["imports", "AGENTS.md", "assessment", "resources", "rubrics", "teacher-private"])
    );
  }

  async exportTeacherPackage(
    activityRoot: string,
    destination: string
  ): Promise<void> {
    const result = await this.validation.validate(activityRoot);
    if (!result.valid) {
      throw new Error(
        `Activity has validation errors: ${result.errors
          .map((issue) => issue.message)
          .join("; ")}`
      );
    }
    await this.evidence.ensureKeyPair(activityRoot);
    await this.zip.createFromDirectory(
      activityRoot,
      destination,
      new Set(["node_modules", ".git", "dist", "out"])
    );
  }
}
