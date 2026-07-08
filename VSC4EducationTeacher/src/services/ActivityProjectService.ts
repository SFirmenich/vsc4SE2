import { promises as fs } from "fs";
import * as path from "path";
import { ActivityManifest } from "../types/ActivityManifest";
import { readJson, writeJson } from "../utils/fs";
import { AssessmentService } from "./AssessmentService";

export const DEFAULT_AGENT_INSTRUCTIONS = `# Agent instructions

You are a pedagogical reviewer.

- Do not implement solutions for the student.
- Do not rewrite functional code.
- Add only comments prefixed with \`AI-REVIEW\` when code annotations are necessary.
- Consult the theory, task descriptions, and current task state before responding.
- Record conversations in the file indicated by the student extension.
- Explain concepts and ask guiding questions instead of completing the work.
`;

export const DEFAULT_ASSESSMENT_RUBRIC_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://vsc4education.local/schemas/assessment-rubric.schema.json",
  "title": "VSCode4Education Assessment Rubric",
  "description": "Private per-task teacher assessment rubric for assessment/rubrics/<taskId>.yml.",
  "type": "object",
  "required": [
    "maxScore",
    "requiresTeacherReview",
    "criteria",
    "agency"
  ],
  "additionalProperties": false,
  "properties": {
    "taskId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$",
      "description": "Optional task ID. When present, it must match the manifest task ID and file name."
    },
    "maxScore": {
      "type": "number",
      "exclusiveMinimum": 0,
      "description": "Maximum score for this task. All task maxScore values across the activity must total 100."
    },
    "requiresTeacherReview": {
      "type": "boolean",
      "description": "Whether the teacher must review or confirm the proposed score."
    },
    "criteria": {
      "type": "array",
      "minItems": 1,
      "description": "Private scoring criteria for this task.",
      "items": {
        "$ref": "#/$defs/criterion"
      }
    },
    "agency": {
      "$ref": "#/$defs/agency"
    }
  },
  "$defs": {
    "criterion": {
      "type": "object",
      "required": [
        "id",
        "maxScore",
        "allowsPartialCredit"
      ],
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$"
        },
        "title": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "maxScore": {
          "type": "number",
          "minimum": 0
        },
        "allowsPartialCredit": {
          "type": "boolean",
          "description": "If true, intermediate scores are allowed. If false, the criterion is all-or-nothing."
        }
      }
    },
    "agency": {
      "type": "object",
      "required": [
        "mode"
      ],
      "additionalProperties": false,
      "properties": {
        "mode": {
          "enum": [
            "none",
            "weighted",
            "modifier",
            "cap",
            "bonus"
          ]
        },
        "maxScore": {
          "type": "number",
          "minimum": 0,
          "description": "Points reserved for agency when mode is weighted."
        },
        "maxAdjustment": {
          "type": "number",
          "minimum": 0,
          "description": "Maximum absolute score adjustment for modifier or bonus modes."
        },
        "rules": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/agencyRule"
          }
        }
      }
    },
    "agencyRule": {
      "type": "object",
      "required": [
        "metric",
        "when"
      ],
      "additionalProperties": false,
      "properties": {
        "metric": {
          "type": "string",
          "examples": [
            "observableAgency.score"
          ]
        },
        "when": {
          "type": "string",
          "description": "Simple condition over the metric, such as \\">= 80\\" or \\"< 40\\"."
        },
        "reason": {
          "type": "string"
        },
        "adjustment": {
          "type": "number"
        },
        "score": {
          "type": "number",
          "minimum": 0
        },
        "cap": {
          "type": "number",
          "minimum": 0
        }
      }
    }
  }
}
`;

export const DEFAULT_AUTHORING_AGENTS = `# AGENTS.md

This folder is a VSCode4Education teacher activity project. It is the source
workspace used to author a portable learning activity package.

## Canonical Activity Structure

- \`manifest.json\` defines the activity identity, version, type, and task list.
- \`tasks/\` contains the student-facing task statements referenced by
  \`manifest.tasks[*].file\`.
- \`theory/\` contains student-facing theory and support material.
- \`agent/instructions.md\` contains the pedagogical agent instructions that will
  be packaged for students.
- \`starter/\` contains the starter project copied into each student workspace.
- \`assessment/rubrics/\` contains private per-task YAML rubrics.
- \`assessment/solutions/\` contains private official per-task solutions.
- \`resources/assessment-rubric.schema.json\` documents the YAML schema used by
  \`assessment/rubrics/*.yml\`.
- \`rubrics/\` may contain legacy evaluation rubrics.
- \`signatures/\` contains generated package hashes or related metadata.

## Imported Source Material

The \`imports/\` folder is local teacher authoring material:

- \`imports/theory/\` is for previous theory files, PDFs, DOCX files, slides, or
  notes that can help create or improve \`theory/\`.
- \`imports/practice/\` is for previous assignments, exercise sheets, examples,
  solutions, tests, or other practice material that can help create or improve
  \`tasks/\` and \`starter/\`.

Treat \`imports/\` as source material, not as the portable activity contract. Do
not assume these files are student-ready. When the teacher asks you to port,
adapt, summarize, split, or update an activity, use the relevant files from
\`imports/\` to modify the canonical files under \`tasks/\`, \`theory/\`,
\`agent/\`, \`assessment/\`, \`rubrics/\`, or \`starter/\`.

## Assessment Authoring Rules

When helping generate assessment material:

- Create one private rubric at \`assessment/rubrics/<taskId>.yml\` and one
  official solution at \`assessment/solutions/<taskId>.md\` for every
  \`manifest.tasks[*].id\`.
- Follow \`resources/assessment-rubric.schema.json\` for YAML structure.
- Rubric YAML must contain only private \`criteria\`; do not create
  \`publicCriteria\` or \`visibility\` fields.
- Every criterion needs \`id\`, \`maxScore\`, and explicit
  \`allowsPartialCredit: true\` or \`allowsPartialCredit: false\`.
- The sum of all task \`maxScore\` values across assessment rubrics must be 100.
- Public acceptance criteria belong in \`manifest.tasks[*].acceptanceCriteria\`,
  not in assessment YAML.
- Official solutions should explain intent, reference implementation,
  acceptable variants, common mistakes, and notes for assisted evaluation.

## Authoring Rules

- Keep task IDs stable and referenced through \`manifest.tasks[*].id\`.
- Keep task file paths relative to this activity folder.
- Do not place direct solutions in student-facing task or agent instruction
  files unless the teacher explicitly asks for teacher-only material.
- Preserve compatibility with the activity ZIP format consumed by the student
  extension.
- Do not execute code, install dependencies, or run scripts from imported source
  material unless the teacher explicitly requests it.
`;

export class ActivityProjectService {
  constructor(private readonly assessment = new AssessmentService()) {}

  async initialize(
    root: string,
    manifest: ActivityManifest
  ): Promise<string> {
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(path.join(root, "theory"), { recursive: true });
    await fs.mkdir(path.join(root, "tasks"), { recursive: true });
    await fs.mkdir(path.join(root, "imports", "theory"), { recursive: true });
    await fs.mkdir(path.join(root, "imports", "practice"), { recursive: true });
    await fs.mkdir(path.join(root, "agent"), { recursive: true });
    await fs.mkdir(path.join(root, "starter"), { recursive: true });
    await fs.mkdir(path.join(root, "resources"), { recursive: true });
    await fs.mkdir(path.join(root, "rubrics"), { recursive: true });
    await fs.mkdir(path.join(root, "assessment", "rubrics"), { recursive: true });
    await fs.mkdir(path.join(root, "assessment", "solutions"), { recursive: true });
    await fs.mkdir(path.join(root, "signatures"), { recursive: true });
    await writeJson(path.join(root, "manifest.json"), manifest);
    await fs.writeFile(
      path.join(root, "agent", "instructions.md"),
      DEFAULT_AGENT_INSTRUCTIONS,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "AGENTS.md"),
      DEFAULT_AUTHORING_AGENTS,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "starter", ".gitkeep"),
      "",
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "resources", "assessment-rubric.schema.json"),
      DEFAULT_ASSESSMENT_RUBRIC_SCHEMA,
      "utf8"
    );
    await this.ensureAssessmentFiles(root, manifest);
    return root;
  }

  async create(
    parentDirectory: string,
    manifest: ActivityManifest
  ): Promise<string> {
    const root = path.join(parentDirectory, manifest.id);
    return this.initialize(root, manifest);
  }

  load(root: string): Promise<ActivityManifest> {
    return readJson<ActivityManifest>(path.join(root, "manifest.json"));
  }

  save(root: string, manifest: ActivityManifest): Promise<void> {
    return writeJson(path.join(root, "manifest.json"), manifest);
  }

  async ensureAssessmentFiles(root: string, manifest: ActivityManifest): Promise<void> {
    await fs.mkdir(path.join(root, "assessment", "rubrics"), { recursive: true });
    await fs.mkdir(path.join(root, "assessment", "solutions"), { recursive: true });
    const defaultScore = manifest.tasks?.length === 1 ? 100 : 0;
    for (const task of manifest.tasks ?? []) {
      const rubricPath = path.join(root, "assessment", "rubrics", `${task.id}.yml`);
      if (!(await exists(rubricPath))) {
        await fs.writeFile(
          rubricPath,
          this.assessment.defaultRubric(task.id, roundScore(defaultScore)),
          "utf8"
        );
      }
      const solutionPath = path.join(root, "assessment", "solutions", `${task.id}.md`);
      if (!(await exists(solutionPath))) {
        await fs.writeFile(
          solutionPath,
          this.assessment.defaultSolution(task.title),
          "utf8"
        );
      }
    }
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}
