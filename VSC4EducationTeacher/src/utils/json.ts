export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function parseJsonLines<T>(
  content: string
): { values: T[]; invalidLines: number[] } {
  const values: T[] = [];
  const invalidLines: number[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) {
      return;
    }
    try {
      values.push(JSON.parse(line) as T);
    } catch {
      invalidLines.push(index + 1);
    }
  });
  return { values, invalidLines };
}
