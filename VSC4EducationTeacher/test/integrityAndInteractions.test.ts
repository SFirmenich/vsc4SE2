import * as assert from "assert";
import { promises as fs } from "fs";
import * as path from "path";
import { AgencyMetricsService } from "../src/services/AgencyMetricsService";
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

  it("calculates grouped agency metrics from student events", () => {
    const metrics = new AgencyMetricsService().calculate(
      {
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
            timestamp: "2026-01-01T10:01:00Z",
            event: "active_editor_changed",
            taskId: "task",
            data: { file: "src/Animal.ts" },
            previousHash: "one",
            hash: "two"
          },
          {
            timestamp: "2026-01-01T10:02:00Z",
            event: "file_changed",
            taskId: "task",
            data: {
              file: "src/Animal.ts",
              changeCount: 2,
              lines: [{ start: 2, end: 4 }]
            },
            previousHash: "two",
            hash: "three"
          },
          {
            timestamp: "2026-01-01T10:03:00Z",
            event: "file_saved",
            taskId: "task",
            data: { file: "src/Animal.ts" },
            previousHash: "three",
            hash: "four"
          },
          {
            timestamp: "2026-01-01T10:04:00Z",
            event: "file_created",
            taskId: "task",
            data: { file: "tests/animal.test.ts" },
            previousHash: "four",
            hash: "five"
          },
          {
            timestamp: "2026-01-01T10:05:00Z",
            event: "active_editor_changed",
            data: { file: ".vsc4education/state.json" },
            previousHash: "five",
            hash: "six"
          },
          {
            timestamp: "2026-01-01T10:05:30Z",
            event: "file_changed",
            data: { file: ".vsc4education/state.json", changeCount: 1 },
            previousHash: "six",
            hash: "seven"
          },
          {
            timestamp: "2026-01-01T10:06:00Z",
            event: "task_finished",
            taskId: "task",
            previousHash: "seven",
            hash: "eight"
          },
          {
            timestamp: "2026-01-01T10:07:00Z",
            event: "submission_exported",
            previousHash: "eight",
            hash: "nine"
          }
        ],
        eventParseErrors: [],
        agentInteractions: [],
        interactionErrors: []
      },
      {
        id: "activity",
        title: "Activity",
        tasks: [{ id: "task", title: "Task", file: "src/Animal.ts" }]
      }
    );

    const metric = (id: number) =>
      metrics.groups.flatMap((group) => group.metrics).find((item) => item.id === id);

    assert.strictEqual(metrics.groups.length > 5, true);
    assert.strictEqual(metric(9)?.value, 3);
    assert.strictEqual(metric(12)?.value, 100);
    assert.strictEqual(metric(13)?.value, 3);
    assert.strictEqual(metric(20)?.value, 2);
    assert.strictEqual(metric(43)?.value, 0);
    assert.strictEqual(metric(47)?.value, 1);
    assert.strictEqual(metric(48)?.value, "continua");
    assert.strictEqual(typeof metrics.observableAgency.score, "number");
    assert.ok(metrics.observableAgency.score >= 0);
    assert.ok(metrics.observableAgency.score <= 100);
    assert.ok(metrics.observableAgency.dimensions.length >= 6);
    assert.ok(
      ["muy alta", "alta", "media", "baja", "insuficiente"].includes(
        metrics.observableAgency.level
      )
    );
  });
});
