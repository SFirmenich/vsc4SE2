import { createHash, randomUUID } from "crypto";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createId(): string {
  return randomUUID();
}
