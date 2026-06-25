import * as assert from "assert";
import { promises as fs } from "fs";
import * as path from "path";
import { IntegrityService } from "../src/services/IntegrityService";
import { SubmissionReviewService } from "../src/services/SubmissionReviewService";
import { canonicalJson } from "../src/utils/json";
import { sha256 } from "../src/utils/crypto";
import { tempDirectory } from "./helpers";

describe("Integrity and agent interactions", () => {
  it("accepts a valid event chain and rejects a modified event", () => {
    const firstWithoutHash = {
      id: "one",
      timestamp: "2026-01-01T00:00:00Z",
      type: "task_started",
      previousHash: null
    };
    const first = {
      ...firstWithoutHash,
      hash: sha256(canonicalJson(firstWithoutHash))
    };
    const secondWithoutHash = {
      id: "two",
      timestamp: "2026-01-01T00:01:00Z",
      type: "task_completed",
      previousHash: first.hash
    };
    const second = {
      ...secondWithoutHash,
      hash: sha256(`${first.hash}${canonicalJson(secondWithoutHash)}`)
    };
    const valid = `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`;
    assert.strictEqual(new IntegrityService().verify(valid).status, "valid");
    const modified = valid.replace("task_completed", "file_saved");
    assert.strictEqual(new IntegrityService().verify(modified).status, "invalid");
  });

  it("reports invalid JSON as incomplete", () => {
    const result = new IntegrityService().verify("{not json}\n");
    assert.strictEqual(result.status, "incomplete");
    assert.strictEqual(result.firstInvalidLine, 1);
  });

  it("validates providers, timestamps, actors, and chronological order", async () => {
    const root = await tempDirectory("lat-interactions-");
    const target = path.join(root, "interactions.jsonl");
    await fs.writeFile(
      target,
      [
        '{"timestamp":"2026-01-01T10:01:00Z","actor":"agent","agent":"claude","message":"Question"}',
        '{"timestamp":"2026-01-01T10:00:00Z","actor":"student","message":"Earlier"}',
        '{"timestamp":"bad","actor":"agent","agent":"unknown","message":"Bad"}'
      ].join("\n")
    );
    const result = await new SubmissionReviewService().readInteractions(target);
    assert.strictEqual(result.values.length, 2);
    assert.ok(result.errors.some((error) => error.includes("chronological")));
    assert.ok(result.errors.some((error) => error.includes("Invalid interaction")));
  });

  it("summarizes teacher-facing agency and line evidence", () => {
    const summary = new SubmissionReviewService().summarize({
      studentId: "student-1",
      events: [
        {
          timestamp: "2026-01-01T10:00:00Z",
          event: "task_started",
          taskId: "task",
          previousHash: null,
          hash: "one"
        },
        {
          timestamp: "2026-01-01T10:05:00Z",
          event: "file_changed",
          taskId: "task",
          data: {
            file: "src/Animal.ts",
            lines: [{ start: 1, end: 3 }]
          },
          previousHash: "one",
          hash: "two"
        },
        {
          timestamp: "2026-01-01T10:07:00Z",
          type: "file_changed",
          taskId: "task",
          data: {
            file: "src/Animal.ts",
            lines: [{ start: 3, end: 4 }]
          },
          previousHash: "two",
          hash: "three"
        }
      ],
      eventParseErrors: [],
      agentInteractions: [
        {
          timestamp: "2026-01-01T10:03:00Z",
          actor: "student",
          message: "Can you ask me a guiding question?"
        },
        {
          timestamp: "2026-01-01T10:04:00Z",
          actor: "agent",
          agent: "claude",
          message: "What invariant should Animal protect?"
        }
      ],
      interactionErrors: []
    });

    assert.strictEqual(summary.studentId, "student-1");
    assert.strictEqual(summary.filesModified, 1);
    assert.strictEqual(summary.lineTouchCount, 5);
    assert.strictEqual(summary.uniqueLinesTouched, 4);
    assert.deepStrictEqual(summary.linesByFile, [
      { file: "src/Animal.ts", lines: 4 }
    ]);
    assert.strictEqual(summary.agentInteractions, 2);
    assert.deepStrictEqual(
      (summary.agency as { level: string }).level,
      "media"
    );
  });
});
