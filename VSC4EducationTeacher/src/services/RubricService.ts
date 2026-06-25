import { Rubric } from "../types/Rubric";
import { ValidationIssue } from "../types/Validation";
import { VALID_ID } from "../utils/validation";

export class RubricService {
  validate(rubric: Rubric, taskIds: Set<string>): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const criterionIds = new Set<string>();
    let totalWeight = 0;

    for (const criterion of rubric.criteria ?? []) {
      if (!VALID_ID.test(criterion.id) || criterionIds.has(criterion.id)) {
        issues.push({
          severity: "error",
          code: "rubric.criterionId",
          message: `Invalid or duplicate rubric criterion ID: ${criterion.id}`
        });
      }
      criterionIds.add(criterion.id);
      if (!Number.isFinite(criterion.weight) || criterion.weight < 0) {
        issues.push({
          severity: "error",
          code: "rubric.weight",
          message: `Criterion ${criterion.id} has an invalid weight`
        });
      } else {
        totalWeight += criterion.weight;
      }
      for (const taskId of criterion.taskIds ?? []) {
        if (!taskIds.has(taskId)) {
          issues.push({
            severity: "error",
            code: "rubric.taskReference",
            message: `Criterion ${criterion.id} references unknown task ${taskId}`
          });
        }
      }
      const values = (criterion.levels ?? []).map((level) => level.value);
      if (
        values.length === 0 ||
        values.some((value) => !Number.isFinite(value)) ||
        values.some((value, index) => index > 0 && value <= values[index - 1])
      ) {
        issues.push({
          severity: "error",
          code: "rubric.levels",
          message: `Criterion ${criterion.id} levels must be non-empty and ordered`
        });
      }
    }
    if (Math.abs(totalWeight - 100) > 0.001) {
      issues.push({
        severity: "warning",
        code: "rubric.totalWeight",
        message: `Rubric weights total ${totalWeight}; expected 100`
      });
    }
    return issues;
  }
}
