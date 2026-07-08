import { promises as fs } from "fs";
import * as path from "path";
import { listFiles, writeJson } from "../utils/fs";
import { sha256 } from "../utils/crypto";
import { ActivityValidationService } from "./ActivityValidationService";
import { ZipService } from "./ZipService";

export class ActivityPackageService {
  constructor(
    private readonly validation = new ActivityValidationService(),
    private readonly zip = new ZipService()
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
    if (includeHashes) {
      const hashes: Record<string, string> = {};
      for (const file of await listFiles(activityRoot)) {
        const relative = path.relative(activityRoot, file).replace(/\\/g, "/");
        if (
          relative === "signatures/hashes.json" ||
          relative === "AGENTS.md" ||
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
      new Set(["imports", "AGENTS.md"])
    );
  }
}
