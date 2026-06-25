import { promises as fs } from "fs";
import * as path from "path";

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(target: string): Promise<T> {
  return JSON.parse(await fs.readFile(target, "utf8")) as T;
}

export async function writeJson(target: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function listFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile()) {
        output.push(full);
      }
    }
  }
  if (await pathExists(root)) {
    await visit(root);
  }
  return output;
}
