import { promises as fs } from "fs";
import * as path from "path";
import {
  AssessmentAgency,
  AssessmentCriterion,
  AssessmentRubric
} from "../types/AssessmentRubric";
import { ActivityManifest } from "../types/ActivityManifest";
import { ValidationIssue } from "../types/Validation";
import { pathExists } from "../utils/fs";
import { parseSimpleYaml } from "../utils/simpleYaml";
import { VALID_ID } from "../utils/validation";

const SCORE_TOLERANCE = 0.001;
const AGENCY_MODES = new Set(["none", "weighted", "modifier", "cap", "bonus"]);

export class AssessmentService {
  async validate(root: string, manifest: ActivityManifest): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const taskIds = new Set((manifest.tasks ?? []).map((task) => task.id));
    const assessmentRoot = path.join(root, "assessment");
    const rubricsRoot = path.join(assessmentRoot, "rubrics");
    const solutionsRoot = path.join(assessmentRoot, "solutions");
    let totalScore = 0;

    if (!(await pathExists(assessmentRoot))) {
      issues.push({
        severity: "error",
        code: "assessment.missing",
        message: "assessment/ is missing"
      });
      return issues;
    }
    for (const required of [rubricsRoot, solutionsRoot]) {
      if (!(await pathExists(required))) {
        issues.push({
          severity: "error",
          code: "assessment.requiredPath",
          message: `Required assessment path is missing: ${path.relative(root, required).replace(/\\/g, "/")}`
        });
      }
    }

    for (const task of manifest.tasks ?? []) {
      const rubricPath = path.join(rubricsRoot, `${task.id}.yml`);
      const solutionPath = path.join(solutionsRoot, `${task.id}.md`);
      if (!(await pathExists(rubricPath))) {
        issues.push({
          severity: "error",
          code: "assessment.rubricMissing",
          message: `Assessment rubric is missing for task ${task.id}: assessment/rubrics/${task.id}.yml`
        });
      } else {
        const rubric = await this.readRubric(rubricPath, task.id, issues);
        if (rubric) {
          totalScore += rubric.maxScore;
          issues.push(...this.validateRubric(rubric, task.id));
        }
      }
      if (!(await pathExists(solutionPath))) {
        issues.push({
          severity: "error",
          code: "assessment.solutionMissing",
          message: `Official solution is missing for task ${task.id}: assessment/solutions/${task.id}.md`
        });
      }
    }

    await this.findOrphanFiles(rubricsRoot, ".yml", taskIds, "assessment.rubricOrphan", issues);
    await this.findOrphanFiles(solutionsRoot, ".md", taskIds, "assessment.solutionOrphan", issues);

    if (Math.abs(totalScore - 100) > SCORE_TOLERANCE) {
      issues.push({
        severity: "error",
        code: "assessment.totalScore",
        message: `Assessment task scores total ${totalScore}; expected 100`
      });
    }
    return issues;
  }

  defaultRubric(taskId: string, maxScore = 100): string {
    return [
      `taskId: ${taskId}`,
      `maxScore: ${maxScore}`,
      "requiresTeacherReview: true",
      "criteria:",
      "  - id: correctness",
      "    title: Correctness",
      `    maxScore: ${maxScore}`,
      "    allowsPartialCredit: true",
      "    description: Meets the private evaluation expectations for this task.",
      "agency:",
      "  mode: none",
      ""
    ].join("\n");
  }

  defaultSolution(taskTitle: string): string {
    return [
      `# Official solution: ${taskTitle}`,
      "",
      "## Expected intent",
      "",
      "## Reference implementation",
      "",
      "## Acceptable variants",
      "",
      "## Common mistakes",
      "",
      "## Notes for assisted evaluation",
      ""
    ].join("\n");
  }

  private async readRubric(
    rubricPath: string,
    taskId: string,
    issues: ValidationIssue[]
  ): Promise<AssessmentRubric | undefined> {
    try {
      const parsed = parseSimpleYaml(await fs.readFile(rubricPath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Rubric root must be a mapping");
      }
      return parsed as AssessmentRubric;
    } catch (error) {
      issues.push({
        severity: "error",
        code: "assessment.rubricInvalidYaml",
        message: `assessment/rubrics/${taskId}.yml is not valid supported YAML: ${error instanceof Error ? error.message : String(error)}`
      });
      return undefined;
    }
  }

  private validateRubric(rubric: AssessmentRubric, taskId: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (rubric.taskId !== undefined && rubric.taskId !== taskId) {
      issues.push({
        severity: "error",
        code: "assessment.taskId",
        message: `Rubric taskId ${rubric.taskId} does not match file task ${taskId}`
      });
    }
    if (!Number.isFinite(rubric.maxScore) || rubric.maxScore <= 0) {
      issues.push({
        severity: "error",
        code: "assessment.maxScore",
        message: `Rubric ${taskId} requires a positive maxScore`
      });
    }
    if (typeof rubric.requiresTeacherReview !== "boolean") {
      issues.push({
        severity: "warning",
        code: "assessment.requiresTeacherReview",
        message: `Rubric ${taskId} should explicitly set requiresTeacherReview`
      });
    }

    const criteria = Array.isArray(rubric.criteria) ? rubric.criteria : [];
    if (!criteria.length) {
      issues.push({
        severity: "error",
        code: "assessment.criteria",
        message: `Rubric ${taskId} requires at least one private criterion`
      });
    }
    const criterionIds = new Set<string>();
    let criteriaScore = 0;
    for (const criterion of criteria) {
      if (!criterion || typeof criterion !== "object" || Array.isArray(criterion)) {
        issues.push({
          severity: "error",
          code: "assessment.criteria",
          message: `Rubric ${taskId} criteria entries must be mappings`
        });
        continue;
      }
      issues.push(...this.validateCriterion(criterion, taskId, criterionIds));
      if (Number.isFinite(criterion.maxScore)) {
        criteriaScore += criterion.maxScore;
      }
    }

    const agency = rubric.agency;
    const weightedAgencyScore =
      agency?.mode === "weighted" && Number.isFinite(agency.maxScore)
        ? Number(agency.maxScore)
        : 0;
    const expectedCriteriaScore = rubric.maxScore - weightedAgencyScore;
    if (
      Number.isFinite(rubric.maxScore) &&
      Math.abs(criteriaScore - expectedCriteriaScore) > SCORE_TOLERANCE
    ) {
      issues.push({
        severity: "error",
        code: "assessment.criteriaScore",
        message: `Rubric ${taskId} criteria total ${criteriaScore}; expected ${expectedCriteriaScore}`
      });
    }
    if (agency) {
      issues.push(...this.validateAgency(agency, taskId));
    }
    return issues;
  }

  private validateCriterion(
    criterion: AssessmentCriterion,
    taskId: string,
    criterionIds: Set<string>
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!VALID_ID.test(criterion.id) || criterionIds.has(criterion.id)) {
      issues.push({
        severity: "error",
        code: "assessment.criterionId",
        message: `Invalid or duplicate criterion ID in ${taskId}: ${criterion.id}`
      });
    }
    criterionIds.add(criterion.id);
    if (!Number.isFinite(criterion.maxScore) || criterion.maxScore < 0) {
      issues.push({
        severity: "error",
        code: "assessment.criterionScore",
        message: `Criterion ${criterion.id} in ${taskId} has an invalid maxScore`
      });
    }
    if (typeof criterion.allowsPartialCredit !== "boolean") {
      issues.push({
        severity: "error",
        code: "assessment.partialCredit",
        message: `Criterion ${criterion.id} in ${taskId} must set allowsPartialCredit true or false`
      });
    }
    if ("visibility" in criterion || "publicCriteria" in criterion) {
      issues.push({
        severity: "error",
        code: "assessment.privateOnly",
        message: `Criterion ${criterion.id} in ${taskId} must not define public visibility fields`
      });
    }
    return issues;
  }

  private validateAgency(agency: AssessmentAgency, taskId: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!AGENCY_MODES.has(agency.mode)) {
      issues.push({
        severity: "error",
        code: "assessment.agencyMode",
        message: `Rubric ${taskId} uses an unknown agency mode: ${agency.mode}`
      });
    }
    if (agency.mode === "weighted" && (!Number.isFinite(agency.maxScore) || Number(agency.maxScore) < 0)) {
      issues.push({
        severity: "error",
        code: "assessment.agencyScore",
        message: `Rubric ${taskId} agency mode weighted requires maxScore >= 0`
      });
    }
    if (["modifier", "bonus"].includes(agency.mode) && (!Number.isFinite(agency.maxAdjustment) || Number(agency.maxAdjustment) < 0)) {
      issues.push({
        severity: "error",
        code: "assessment.agencyAdjustment",
        message: `Rubric ${taskId} agency mode ${agency.mode} requires maxAdjustment >= 0`
      });
    }
    if (agency.rules !== undefined && !Array.isArray(agency.rules)) {
      issues.push({
        severity: "error",
        code: "assessment.agencyRules",
        message: `Rubric ${taskId} agency rules must be a list`
      });
    }
    return issues;
  }

  private async findOrphanFiles(
    directory: string,
    extension: string,
    taskIds: Set<string>,
    code: string,
    issues: ValidationIssue[]
  ): Promise<void> {
    if (!(await pathExists(directory))) return;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(extension)) continue;
      const id = entry.name.slice(0, -extension.length);
      if (!taskIds.has(id)) {
        issues.push({
          severity: "warning",
          code,
          message: `Assessment file has no matching manifest task: ${entry.name}`
        });
      }
    }
  }
}
