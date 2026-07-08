import * as path from "path";
import { promises as fs } from "fs";
import { ActivityManifest } from "../types/ActivityManifest";
import { Rubric } from "../types/Rubric";
import {
  ValidationIssue,
  ValidationResult
} from "../types/Validation";
import { pathExists, readJson } from "../utils/fs";
import { isSafeRelativePath, resolveInside } from "../utils/paths";
import { hasCycle, VALID_ID } from "../utils/validation";
import { RubricService } from "./RubricService";

export class ActivityValidationService {
  constructor(private readonly rubricService = new RubricService()) {}

  async validate(root: string): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const manifestPath = path.join(root, "manifest.json");
    if (!(await pathExists(manifestPath))) {
      issues.push({
        severity: "error",
        code: "manifest.missing",
        message: "manifest.json is missing"
      });
      return this.result(issues);
    }

    let manifest: ActivityManifest;
    try {
      manifest = await readJson<ActivityManifest>(manifestPath);
    } catch {
      issues.push({
        severity: "error",
        code: "manifest.invalidJson",
        message: "manifest.json is not valid JSON"
      });
      return this.result(issues);
    }

    if (!manifest.id || !VALID_ID.test(manifest.id)) {
      issues.push({
        severity: "error",
        code: "manifest.id",
        message: "Activity ID is missing or invalid"
      });
    }
    if (!manifest.title?.trim()) {
      issues.push({
        severity: "error",
        code: "manifest.title",
        message: "Activity title is required"
      });
    }
    if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0) {
      issues.push({
        severity: "error",
        code: "tasks.empty",
        message: "At least one task is required"
      });
    }

    const taskIds = new Set<string>();
    for (const task of manifest.tasks ?? []) {
      if (!task.id || !VALID_ID.test(task.id) || taskIds.has(task.id)) {
        issues.push({
          severity: "error",
          code: "task.id",
          message: `Task ID is missing, invalid, or duplicated: ${task.id ?? ""}`
        });
      }
      taskIds.add(task.id);
      if (!task.title?.trim()) {
        issues.push({
          severity: "error",
          code: "task.title",
          message: `Task ${task.id} requires a title`
        });
      }
      if (task.file) {
        if (!isSafeRelativePath(task.file)) {
          issues.push({
            severity: "error",
            code: "task.path",
            message: `Task ${task.id} uses an unsafe file path`
          });
        } else if (!(await pathExists(resolveInside(root, task.file)))) {
          issues.push({
            severity: "error",
            code: "task.fileMissing",
            message: `Referenced task file is missing: ${task.file}`
          });
        }
      }
      for (const dependency of task.dependencies ?? []) {
        if (!taskIds.has(dependency) && !(manifest.tasks ?? []).some((t) => t.id === dependency)) {
          issues.push({
            severity: "error",
            code: "task.dependencyMissing",
            message: `Task ${task.id} references unknown dependency ${dependency}`
          });
        }
      }
    }
    if (hasCycle(manifest.tasks ?? [])) {
      issues.push({
        severity: "error",
        code: "task.cycle",
        message: "Task dependencies contain a cycle"
      });
    }

    for (const required of [
      "starter",
      path.join("agent", "instructions.md")
    ]) {
      if (!(await pathExists(path.join(root, required)))) {
        issues.push({
          severity: "error",
          code: "package.requiredPath",
          message: `Required package path is missing: ${required}`
        });
      }
    }

    const rubricPath = path.join(root, "rubrics", "main.json");
    if (await pathExists(rubricPath)) {
      try {
        const rubric = await readJson<Rubric>(rubricPath);
        issues.push(...this.rubricService.validate(rubric, taskIds));
      } catch {
        issues.push({
          severity: "error",
          code: "rubric.invalidJson",
          message: "rubrics/main.json is not valid JSON"
        });
      }
    } else {
      issues.push({
        severity: "info",
        code: "rubric.missing",
        message: "No main rubric is defined"
      });
    }

    await this.findDiscouraged(root, root, issues);
    return this.result(issues);
  }

  private async findDiscouraged(
    root: string,
    current: string,
    issues: ValidationIssue[]
  ): Promise<void> {
    const discouraged = new Set(["node_modules", ".git", "dist", "out"]);
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const full = path.join(current, entry.name);
      if (discouraged.has(entry.name)) {
        issues.push({
          severity: "warning",
          code: "package.discouraged",
          message: `Discouraged directory found: ${path.relative(root, full)}`
        });
      } else {
        await this.findDiscouraged(root, full, issues);
      }
    }
  }

  private result(issues: ValidationIssue[]): ValidationResult {
    const errors = issues.filter((issue) => issue.severity === "error");
    const warnings = issues.filter((issue) => issue.severity === "warning");
    const info = issues.filter((issue) => issue.severity === "info");
    return { issues, errors, warnings, info, valid: errors.length === 0 };
  }
}
