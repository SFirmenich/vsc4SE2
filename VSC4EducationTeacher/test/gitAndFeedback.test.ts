import * as assert from "assert";
import { execFileSync } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import { FeedbackService } from "../src/services/FeedbackService";
import { GitReviewService } from "../src/services/GitReviewService";
import { tempDirectory } from "./helpers";

describe("Git review and feedback", function () {
  this.timeout(10000);
  it("reads commits and compares them without modifying the repository", async () => {
    const root = await tempDirectory("lat-git-");
    const git = (args: string[]) =>
      execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git(["init"]);
    git(["config", "user.name", "Teacher Test"]);
    git(["config", "user.email", "teacher@example.test"]);
    await fs.writeFile(path.join(root, "work.txt"), "one\n");
    git(["add", "work.txt"]);
    git(["commit", "-m", "task-1 initial"]);
    const first = git(["rev-parse", "HEAD"]).toString().trim();
    await fs.writeFile(path.join(root, "work.txt"), "one\ntwo\n");
    await fs.writeFile(path.join(root, "added.txt"), "added\n");
    git(["add", "."]);
    git(["commit", "-m", "task-1 complete"]);
    const second = git(["rev-parse", "HEAD"]).toString().trim();

    const service = new GitReviewService();
    const beforeStatus = git(["status", "--porcelain"]).toString();
    const commits = await service.commits(root);
    const changed = await service.changedFiles(root, first, second);
    const stat = await service.diff(root, first, second);
    const afterStatus = git(["status", "--porcelain"]).toString();

    assert.strictEqual(commits.length, 2);
    assert.ok(changed.some((file) => file.path === "added.txt"));
    assert.ok(stat.includes("2 files changed"));
    assert.strictEqual(afterStatus, beforeStatus);
  });

  it("persists feedback outside the submission and exports it", async () => {
    const storage = await tempDirectory("lat-feedback-");
    const submission = path.join(storage, "submissions", "submission-1");
    await fs.mkdir(submission, { recursive: true });
    const marker = path.join(submission, "unchanged.txt");
    await fs.writeFile(marker, "original");
    const service = new FeedbackService();
    const saved = await service.save(storage, {
      submissionId: "submission-1",
      studentId: "student-1",
      status: "completed",
      updatedAt: "old",
      evaluations: [
        { criterionId: "quality", level: 2, score: 20, comment: "Good" }
      ]
    });
    const loaded = await service.load(storage, "submission-1", "student-1");
    const destination = path.join(storage, "feedback.zip");
    await service.export(storage, "submission-1", destination);
    assert.ok(saved.includes(path.join("reviews", "submission-1")));
    assert.strictEqual(loaded.evaluations[0].score, 20);
    assert.strictEqual(await fs.readFile(marker, "utf8"), "original");
    assert.ok((await fs.stat(destination)).size > 0);
  });
});
