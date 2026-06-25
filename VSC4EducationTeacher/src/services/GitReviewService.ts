import { execFile } from "child_process";
import { promisify } from "util";
import { pathExists } from "../utils/fs";
import * as path from "path";

const execFileAsync = promisify(execFile);

export interface GitCommit {
  hash: string;
  author: string;
  email: string;
  timestamp: string;
  message: string;
}

export class GitReviewService {
  async isRepository(root: string): Promise<boolean> {
    return pathExists(path.join(root, ".git"));
  }

  async commits(root: string, limit = 200): Promise<GitCommit[]> {
    const format = "%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e";
    const output = await this.git(root, [
      "log",
      `--max-count=${limit}`,
      `--pretty=format:${format}`
    ]);
    return output
      .split("\x1e")
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [hash, author, email, timestamp, message] = record.split("\x1f");
        return { hash, author, email, timestamp, message };
      });
  }

  async filesForCommit(root: string, commit: string): Promise<string[]> {
    this.assertRevision(commit);
    const output = await this.git(root, [
      "show",
      "--name-only",
      "--format=",
      commit
    ]);
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  async show(root: string, commit: string, file?: string): Promise<string> {
    this.assertRevision(commit);
    const args = ["show", "--no-ext-diff", "--text", commit];
    if (file) {
      args.push("--", file);
    }
    return this.git(root, args);
  }

  async diff(root: string, from: string, to: string): Promise<string> {
    this.assertRevision(from);
    this.assertRevision(to);
    return this.git(root, [
      "diff",
      "--no-ext-diff",
      "--text",
      "--stat",
      from,
      to
    ]);
  }

  async changedFiles(
    root: string,
    from: string,
    to: string
  ): Promise<Array<{ status: string; path: string }>> {
    this.assertRevision(from);
    this.assertRevision(to);
    const output = await this.git(root, [
      "diff",
      "--name-status",
      from,
      to,
      "--",
      ".",
      ":(exclude).vsc4education/events.jsonl",
      ":(exclude)node_modules",
      ":(exclude)dist",
      ":(exclude)out"
    ]);
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [status, ...fileParts] = line.split("\t");
        return { status, path: fileParts.join("\t") };
      });
  }

  private assertRevision(value: string): void {
    if (!/^[A-Za-z0-9._~^/-]+$/.test(value) || value.startsWith("-")) {
      throw new Error("Invalid Git revision");
    }
  }

  private async git(root: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    });
    return stdout;
  }
}
