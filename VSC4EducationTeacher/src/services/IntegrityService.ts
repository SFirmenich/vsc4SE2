import { LearningEvent } from "../types/LearningEvent";
import { canonicalJson, parseJsonLines } from "../utils/json";
import { sha256 } from "../utils/crypto";

export type IntegrityStatus =
  | "valid"
  | "invalid"
  | "incomplete"
  | "not_available";

export interface IntegrityResult {
  status: IntegrityStatus;
  checkedEntries: number;
  firstInvalidLine?: number;
  message: string;
}

export class IntegrityService {
  verify(content: string): IntegrityResult {
    if (!content.trim()) {
      return {
        status: "not_available",
        checkedEntries: 0,
        message: "No event chain is available"
      };
    }
    const parsed = parseJsonLines<LearningEvent>(content);
    if (parsed.invalidLines.length) {
      return {
        status: "incomplete",
        checkedEntries: parsed.values.length,
        firstInvalidLine: parsed.invalidLines[0],
        message: `Invalid JSON at line ${parsed.invalidLines[0]}`
      };
    }
    let previousHash: string | null = null;
    for (let index = 0; index < parsed.values.length; index += 1) {
      const event = parsed.values[index];
      if (event.previousHash !== previousHash || typeof event.hash !== "string") {
        return {
          status: "invalid",
          checkedEntries: index,
          firstInvalidLine: index + 1,
          message: `Broken previousHash link at line ${index + 1}`
        };
      }
      const { hash, ...withoutHash } = event;
      const calculated = sha256(
        `${previousHash === null ? "" : previousHash}${canonicalJson(withoutHash)}`
      );
      if (calculated !== hash) {
        return {
          status: "invalid",
          checkedEntries: index,
          firstInvalidLine: index + 1,
          message: `Hash mismatch at line ${index + 1}`
        };
      }
      previousHash = hash;
    }
    return {
      status: "valid",
      checkedEntries: parsed.values.length,
      message:
        "The local chain is internally consistent; this does not prove absolute authenticity"
    };
  }
}
