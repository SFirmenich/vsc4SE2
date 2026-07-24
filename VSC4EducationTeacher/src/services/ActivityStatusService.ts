import { promises as fs } from "fs";
import * as path from "path";
import {
  ActivityStatus,
  ActivityFileStatus,
  DiscoveredTaskStatus
} from "../types/ActivityStatus";
import { ActivityManifest } from "../types/ActivityManifest";
import { Rubric } from "../types/Rubric";
import { listFiles, pathExists, readJson } from "../utils/fs";
import { isSafeRelativePath, resolveInside } from "../utils/paths";
import { ActivityValidationService } from "./ActivityValidationService";
import {
  EVIDENCE_PRIVATE_KEY_PATH,
  EVIDENCE_PUBLIC_KEY_PATH
} from "./EvidenceCryptoService";

export class ActivityStatusService {
  constructor(
    private readonly validation = new ActivityValidationService()
  ) {}

  async inspect(root: string): Promise<ActivityStatus> {
    const manifestPath = path.join(root, "manifest.json");
    if (!(await pathExists(manifestPath))) {
      return {
        root,
        initialized: false,
        files: [],
        tasks: [],
        discoveredTasks: [],
        nextTaskNumber: 1,
        signaturesGenerated: false,
        counts: {
          tasks: 0,
          theoryFiles: 0,
          starterFiles: 0,
          errors: 0,
          warnings: 0
        }
      };
    }

    let manifest: ActivityManifest | undefined;
    let manifestError: string | undefined;
    try {
      manifest = await readJson<ActivityManifest>(manifestPath);
    } catch (error) {
      manifestError = error instanceof Error ? error.message : String(error);
    }

    const files: ActivityFileStatus[] = [
      await this.fileStatus(root, "manifest.json", "manifest", true),
      await this.fileStatus(
        root,
        "agent/instructions.md",
        "agent",
        true
      )
    ];
    const tasks = [];
    for (const task of manifest?.tasks ?? []) {
      const fileExists =
        typeof task.file === "string" &&
        isSafeRelativePath(task.file) &&
        (await pathExists(resolveInside(root, task.file)));
      tasks.push({
        id: task.id,
        title: task.title,
        file: task.file,
        fileExists,
        dependencies: task.dependencies ?? []
      });
      if (task.file && isSafeRelativePath(task.file)) {
        files.push(
          await this.fileStatus(root, task.file, "task", true)
        );
      }
      files.push(
        await this.fileStatus(root, `assessment/rubrics/${task.id}.yml`, "assessment", true),
        await this.fileStatus(root, `assessment/solutions/${task.id}.md`, "assessment", true)
      );
    }

    const referenced = new Set(files.map((file) => file.path));
    const taskFiles = await this.relativeFiles(root, "tasks");
    const discoveredTasks = await this.discoverTasks(
      root,
      taskFiles,
      referenced
    );
    for (const [directory, kind] of [
      ["tasks", "task"],
      ["theory", "theory"],
      ["assessment", "assessment"],
      ["rubrics", "rubric"],
      ["starter", "starter"]
    ] as const) {
      const directoryFiles =
        directory === "tasks"
          ? taskFiles
          : await this.relativeFiles(root, directory);
      for (const file of directoryFiles) {
        if (!referenced.has(file)) {
          files.push(await this.fileStatus(root, file, kind, false));
        }
      }
    }

    let rubric: Rubric | undefined;
    const rubricPath = path.join(root, "rubrics", "main.json");
    if (await pathExists(rubricPath)) {
      try {
        rubric = await readJson<Rubric>(rubricPath);
      } catch {
        // Validation exposes malformed rubric JSON.
      }
    }
    const validation = await this.validation.validate(root);
    return {
      root,
      initialized: true,
      manifest,
      manifestError,
      rubric,
      files: files.sort((left, right) => left.path.localeCompare(right.path)),
      tasks,
      discoveredTasks,
      nextTaskNumber: this.nextTaskNumber(
        taskFiles,
        (manifest?.tasks ?? []).map((task) => task.id)
      ),
      signaturesGenerated: await this.signaturesGenerated(root),
      validation,
      counts: {
        tasks: tasks.length,
        theoryFiles: files.filter((file) => file.kind === "theory").length,
        starterFiles: files.filter((file) => file.kind === "starter").length,
        errors: validation.errors.length,
        warnings: validation.warnings.length
      }
    };
  }

  private async discoverTasks(
    root: string,
    taskFiles: string[],
    referenced: Set<string>
  ): Promise<DiscoveredTaskStatus[]> {
    const discovered: DiscoveredTaskStatus[] = [];
    for (const file of taskFiles) {
      const match = /^tasks\/task-(\d+)\.md$/i.exec(file);
      if (!match || referenced.has(file)) {
        continue;
      }
      const number = Number.parseInt(match[1], 10);
      discovered.push({
        id: `task-${match[1]}`,
        title: await this.markdownTitle(resolveInside(root, file), `Task ${number}`),
        file,
        number
      });
    }
    return discovered.sort((left, right) => left.number - right.number);
  }

  private nextTaskNumber(taskFiles: string[], taskIds: string[]): number {
    const numbers = [...taskFiles, ...taskIds]
      .map((value) => /(?:^|\/)task-(\d+)(?:\.md)?$/i.exec(value)?.[1])
      .filter((value): value is string => Boolean(value))
      .map((value) => Number.parseInt(value, 10));
    let next = 1;
    const used = new Set(numbers);
    while (used.has(next)) {
      next += 1;
    }
    return next;
  }

  private async markdownTitle(
    target: string,
    fallback: string
  ): Promise<string> {
    const content = await fs.readFile(target, "utf8");
    const heading = content
      .split(/\r?\n/)
      .map((line) => /^#\s+(.+)$/.exec(line)?.[1]?.trim())
      .find(Boolean);
    return heading ?? fallback;
  }

  private async relativeFiles(
    root: string,
    relativeDirectory: string
  ): Promise<string[]> {
    const directory = path.join(root, relativeDirectory);
    return (await listFiles(directory)).map((file) =>
      path.relative(root, file).replace(/\\/g, "/")
    );
  }

  private async fileStatus(
    root: string,
    relativePath: string,
    kind: ActivityFileStatus["kind"],
    referenced: boolean
  ): Promise<ActivityFileStatus> {
    const target = resolveInside(root, relativePath);
    const exists = await pathExists(target);
    return {
      path: relativePath.replace(/\\/g, "/"),
      kind,
      exists,
      referenced,
      size: exists ? (await fs.stat(target)).size : undefined
    };
  }

  private async signaturesGenerated(root: string): Promise<boolean> {
    return (
      (await pathExists(path.join(root, EVIDENCE_PUBLIC_KEY_PATH))) &&
      (await pathExists(path.join(root, EVIDENCE_PRIVATE_KEY_PATH)))
    );
  }
}
