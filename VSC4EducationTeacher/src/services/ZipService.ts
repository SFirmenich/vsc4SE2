import AdmZip from "adm-zip";
import { promises as fs } from "fs";
import * as path from "path";
import { isSafeRelativePath, resolveInside } from "../utils/paths";

export interface ZipLimits {
  maxEntries: number;
  maxUncompressedBytes: number;
}

const DEFAULT_LIMITS: ZipLimits = {
  maxEntries: 10000,
  maxUncompressedBytes: 250 * 1024 * 1024
};

export class ZipService {
  async createFromDirectory(
    source: string,
    destination: string,
    exclude = new Set(["node_modules", ".git", "dist", "out"]),
    excludeRootEntries = new Set<string>()
  ): Promise<void> {
    const zip = new AdmZip();
    const visit = async (current: string): Promise<void> => {
      for (const entry of await fs.readdir(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        const relative = path.relative(source, full).replace(/\\/g, "/");
        if (exclude.has(entry.name) || excludeRootEntries.has(relative)) {
          continue;
        }
        if (entry.isDirectory()) {
          await visit(full);
        } else if (entry.isFile()) {
          zip.addFile(relative, await fs.readFile(full));
        }
      }
    };
    await visit(source);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    zip.writeZip(destination);
  }

  async extractSafe(
    zipPath: string,
    destination: string,
    limits: ZipLimits = DEFAULT_LIMITS
  ): Promise<void> {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    if (entries.length > limits.maxEntries) {
      throw new Error("ZIP contains too many entries");
    }
    let total = 0;
    for (const entry of entries) {
      const name = entry.entryName.replace(/\\/g, "/").replace(/\/$/, "");
      if (!name) {
        continue;
      }
      if (!isSafeRelativePath(name)) {
        throw new Error(`Unsafe ZIP entry: ${entry.entryName}`);
      }
      const target = resolveInside(destination, name);
      if (entry.isDirectory) {
        await fs.mkdir(target, { recursive: true });
        continue;
      }
      const data = entry.getData();
      total += data.length;
      if (total > limits.maxUncompressedBytes) {
        throw new Error("ZIP exceeds the uncompressed size limit");
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, data);
    }
  }
}
