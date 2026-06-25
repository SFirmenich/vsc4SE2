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

export class ActivityProjectService {
  async initialize(
    root: string,
    manifest: ActivityManifest
  ): Promise<string> {
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(path.join(root, "theory"), { recursive: true });
    await fs.mkdir(path.join(root, "tasks"), { recursive: true });
    await fs.mkdir(path.join(root, "agent"), { recursive: true });
    await fs.mkdir(path.join(root, "starter", "proyecto-base"), {
      recursive: true
    });
    await fs.mkdir(path.join(root, "rubrics"), { recursive: true });
    await fs.mkdir(path.join(root, "signatures"), { recursive: true });
    await writeJson(path.join(root, "manifest.json"), manifest);
    await fs.writeFile(
      path.join(root, "agent", "instructions.md"),
      DEFAULT_AGENT_INSTRUCTIONS,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "starter", "proyecto-base", ".gitkeep"),
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
