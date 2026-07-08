import * as assert from "assert";
import AdmZip from "adm-zip";
import { promises as fs } from "fs";
import * as path from "path";
import { ActivityProjectService } from "../src/services/ActivityProjectService";
import { ActivityPackageService } from "../src/services/ActivityPackageService";
import { SubmissionImportService } from "../src/services/SubmissionImportService";
import { ZipService } from "../src/services/ZipService";
import { resolveInside } from "../src/utils/paths";
import { tempDirectory } from "./helpers";

describe("ZIP export and submission import", () => {
  it("exports an activity with manifest.json at the ZIP root", async () => {
    const parent = await tempDirectory("lat-export-");
    const root = await new ActivityProjectService().create(parent, {
      id: "exportable",
      title: "Exportable",
      tasks: [{ id: "task", title: "Task", file: "tasks/task.md" }]
    });
    await fs.writeFile(path.join(root, "tasks", "task.md"), "# Task");
    await fs.writeFile(path.join(root, "imports", "theory", "legacy.pdf"), "PDF");
    await fs.writeFile(
      path.join(root, "imports", "practice", "legacy.docx"),
      "DOCX"
    );
    const destination = path.join(parent, "activity.zip");
    await new ActivityPackageService().export(root, destination);
    const names = new AdmZip(destination).getEntries().map((entry) => entry.entryName);
    assert.ok(names.includes("manifest.json"));
    assert.ok(names.includes("signatures/hashes.json"));
    assert.ok(!names.includes("AGENTS.md"));
    assert.ok(!names.some((name) => name.startsWith("imports/")));
  });

  it("blocks path traversal before resolving extraction targets", () => {
    assert.throws(
      () => resolveInside(path.join("safe", "target"), "../outside.txt"),
      /Unsafe relative path/
    );
    assert.throws(
      () => resolveInside(path.join("safe", "target"), "nested/../../outside.txt"),
      /Unsafe relative path/
    );
  });

  it("imports a submission and reads contributions", async () => {
    const parent = await tempDirectory("lat-import-");
    const source = path.join(parent, "project");
    const metadata = path.join(source, ".vsc4education");
    const student = path.join(metadata, "contributions", "student-1");
    await fs.mkdir(student, { recursive: true });
    await fs.writeFile(
      path.join(metadata, "activity-manifest.json"),
      JSON.stringify({
        id: "activity",
        title: "Activity",
        tasks: [{ id: "task", title: "Task" }]
      })
    );
    await fs.writeFile(
      path.join(student, "events.jsonl"),
      '{"type":"task_started","previousHash":null,"hash":"not-checked-here"}\n'
    );
    await fs.writeFile(
      path.join(student, "agent-interactions.jsonl"),
      '{"timestamp":"2026-01-01T10:00:00Z","actor":"student","message":"Help"}\n'
    );
    const zipPath = path.join(parent, "submission.zip");
    await new ZipService().createFromDirectory(source, zipPath, new Set());
    const imported = await new SubmissionImportService().import(
      zipPath,
      path.join(parent, "storage")
    );
    assert.strictEqual(imported.manifest.id, "activity");
    assert.strictEqual(imported.contributions[0].studentId, "student-1");
    assert.strictEqual(imported.contributions[0].events.length, 1);
  });

  it("imports a submission into a selected inspection directory", async () => {
    const parent = await tempDirectory("lat-import-destination-");
    const source = path.join(parent, "project");
    const metadata = path.join(source, ".vsc4education");
    const student = path.join(metadata, "contributions", "student-1");
    await fs.mkdir(student, { recursive: true });
    await fs.writeFile(
      path.join(metadata, "activity-manifest.json"),
      JSON.stringify({
        id: "activity",
        title: "Activity",
        tasks: [{ id: "task", title: "Task" }]
      })
    );
    await fs.writeFile(path.join(student, "events.jsonl"), "");
    const zipPath = path.join(parent, "submission.zip");
    await new ZipService().createFromDirectory(source, zipPath, new Set());
    const destination = path.join(parent, "teacher-inspection");
    const imported = await new SubmissionImportService().importToDirectory(
      zipPath,
      destination
    );
    assert.ok(imported.rootPath.startsWith(destination));
    assert.strictEqual(imported.projectPath, imported.rootPath);
    assert.ok(await fs.stat(path.join(imported.projectPath, ".vsc4education")));
  });
});
