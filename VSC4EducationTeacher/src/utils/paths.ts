import * as path from "path";

export function isSafeRelativePath(value: string): boolean {
  if (!value || path.isAbsolute(value)) {
    return false;
  }
  const normalized = value.replace(/\\/g, "/");
  return !normalized.split("/").includes("..") && !normalized.startsWith("/");
}

export function resolveInside(root: string, relativePath: string): string {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(`Unsafe relative path: ${relativePath}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escapes root: ${relativePath}`);
  }
  return resolved;
}
