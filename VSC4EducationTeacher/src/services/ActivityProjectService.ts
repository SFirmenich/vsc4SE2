import { promises as fs } from "fs";
import * as path from "path";
import { ActivityManifest } from "../types/ActivityManifest";
import { readJson, writeJson } from "../utils/fs";

export const DEFAULT_AGENT_INSTRUCTIONS = `# Agent instructions

You are a pedagogical reviewer.

- Do not implement solutions for the student.
- Do not rewrite functional code.
- Add only comments prefixed with \`AI-REVIEW\` when code annotations are necessary.
- Consult the theory, task descriptions, and current task state before responding.
- Record conversations in the file indicated by the student extension.
- Explain concepts and ask guiding questions instead of completing the work.
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
- \`starter/\` contains the files copied into \`src/\` in each student
  workspace.
- \`rubrics/\` contains evaluation rubrics.
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
\`agent/\`, \`rubrics/\`, or \`starter/\`.

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
    await fs.mkdir(path.join(root, "rubrics"), { recursive: true });
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
}
