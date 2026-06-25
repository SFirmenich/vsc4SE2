import * as assert from "assert";
import { promises as fs } from "fs";
import * as path from "path";
import { ActivityProjectService } from "../src/services/ActivityProjectService";
import { ActivityStatusService } from "../src/services/ActivityStatusService";
import { tempDirectory } from "./helpers";

describe("Workspace activity status", () => {
  it("reports an uninitialized project when manifest.json is absent", async () => {
    const root = await tempDirectory("lat-status-empty-");
    const status = await new ActivityStatusService().inspect(root);
    assert.strictEqual(status.initialized, false);
    assert.strictEqual(status.counts.tasks, 0);
  });

  it("derives task and file state from the project files", async () => {
    const root = await tempDirectory("lat-status-ready-");
    await new ActivityProjectService().initialize(root, {
      id: "workspace-activity",
      title: "Workspace Activity",
      tasks: [
        {
          id: "task-01",
          title: "First task",
          file: "tasks/task-01.md",
          dependencies: []
        }
      ]
    });
    await fs.writeFile(path.join(root, "tasks", "task-01.md"), "# First task");
    await fs.writeFile(path.join(root, "theory", "guide.md"), "# Guide");

    const status = await new ActivityStatusService().inspect(root);
    assert.strictEqual(status.initialized, true);
    assert.strictEqual(status.counts.tasks, 1);
    assert.strictEqual(status.counts.theoryFiles, 1);
    assert.strictEqual(status.tasks[0].fileExists, true);
    assert.ok(status.files.some((file) => file.path === "theory/guide.md"));
  });

  it("keeps the dashboard available for malformed manifest JSON", async () => {
    const root = await tempDirectory("lat-status-invalid-");
    await fs.writeFile(path.join(root, "manifest.json"), "{ invalid");
    const status = await new ActivityStatusService().inspect(root);
    assert.strictEqual(status.initialized, true);
    assert.strictEqual(status.manifest, undefined);
    assert.ok(status.manifestError);
    assert.strictEqual(status.counts.errors, 1);
  });

  it("discovers unregistered task-N files and calculates the next number", async () => {
    const root = await tempDirectory("lat-status-discovery-");
    await new ActivityProjectService().initialize(root, {
      id: "tracked-tasks",
      title: "Tracked tasks",
      tasks: [
        {
          id: "task-1",
          title: "Registered",
          file: "tasks/task-1.md"
        }
      ]
    });
    await fs.writeFile(path.join(root, "tasks", "task-1.md"), "# Registered");
    await fs.writeFile(
      path.join(root, "tasks", "task-2.md"),
      "# Discovered title\n"
    );
    await fs.writeFile(path.join(root, "tasks", "notes.md"), "# Not a task");

    const status = await new ActivityStatusService().inspect(root);
    assert.strictEqual(status.discoveredTasks.length, 1);
    assert.strictEqual(status.discoveredTasks[0].id, "task-2");
    assert.strictEqual(status.discoveredTasks[0].title, "Discovered title");
    assert.strictEqual(status.nextTaskNumber, 3);
  });
});
