import * as assert from "assert";
import { promises as fs } from "fs";
import * as path from "path";
import { ActivityProjectService } from "../src/services/ActivityProjectService";
import { ActivityValidationService } from "../src/services/ActivityValidationService";
import { RubricService } from "../src/services/RubricService";
import { ActivityManifest } from "../src/types/ActivityManifest";
import { tempDirectory } from "./helpers";

describe("Activity validation", () => {
  async function create(manifest: ActivityManifest): Promise<string> {
    const parent = await tempDirectory("lat-activity-");
    const root = await new ActivityProjectService().create(parent, manifest);
    for (const task of manifest.tasks) {
      if (task.file) {
        const target = path.join(root, task.file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, `# ${task.title}`);
      }
    }
    return root;
  }

  it("accepts a minimal valid manifest", async () => {
    const root = await create({
      id: "activity-1",
      title: "Activity",
      tasks: [{ id: "task-1", title: "Task", file: "tasks/task-1.md" }]
    });
    const result = await new ActivityValidationService().validate(root);
    assert.strictEqual(result.valid, true);
  });

  it("detects invalid and duplicate IDs", async () => {
    const root = await create({
      id: "bad id",
      title: "Activity",
      tasks: [
        { id: "same", title: "One" },
        { id: "same", title: "Two" }
      ]
    });
    const result = await new ActivityValidationService().validate(root);
    assert.ok(result.errors.some((issue) => issue.code === "manifest.id"));
    assert.ok(result.errors.some((issue) => issue.code === "task.id"));
  });

  it("detects circular dependencies", async () => {
    const root = await create({
      id: "cycles",
      title: "Cycles",
      tasks: [
        { id: "a", title: "A", dependencies: ["b"] },
        { id: "b", title: "B", dependencies: ["a"] }
      ]
    });
    const result = await new ActivityValidationService().validate(root);
    assert.ok(result.errors.some((issue) => issue.code === "task.cycle"));
  });

  it("rejects unsafe task paths", async () => {
    const root = await create({
      id: "paths",
      title: "Paths",
      tasks: [{ id: "a", title: "A", file: "../outside.md" }]
    });
    const result = await new ActivityValidationService().validate(root);
    assert.ok(result.errors.some((issue) => issue.code === "task.path"));
  });

  it("validates rubric weights, references, IDs, and levels", () => {
    const issues = new RubricService().validate(
      {
        id: "main",
        title: "Rubric",
        criteria: [
          {
            id: "criterion",
            title: "One",
            weight: -1,
            taskIds: ["missing"],
            levels: [
              { value: 2, label: "High" },
              { value: 1, label: "Low" }
            ]
          }
        ]
      },
      new Set(["task"])
    );
    assert.ok(issues.some((issue) => issue.code === "rubric.weight"));
    assert.ok(issues.some((issue) => issue.code === "rubric.taskReference"));
    assert.ok(issues.some((issue) => issue.code === "rubric.levels"));
    assert.ok(issues.some((issue) => issue.code === "rubric.totalWeight"));
  });

  it("validates per-task private assessment YAML files", async () => {
    const root = await create({
      id: "assessment",
      title: "Assessment",
      tasks: [{ id: "task", title: "Task", file: "tasks/task.md" }]
    });
    await fs.writeFile(
      path.join(root, "assessment", "rubrics", "task.yml"),
      [
        "taskId: task",
        "maxScore: 100",
        "requiresTeacherReview: true",
        "criteria:",
        "  - id: correctness",
        "    title: Correctness",
        "    maxScore: 100",
        "    allowsPartialCredit: true",
        "agency:",
        "  mode: none",
        ""
      ].join("\n")
    );
    await fs.writeFile(
      path.join(root, "assessment", "solutions", "task.md"),
      "# Official solution\n"
    );
    const result = await new ActivityValidationService().validate(root);
    assert.strictEqual(result.valid, true);
  });
});
