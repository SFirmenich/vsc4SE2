import { LearningEvent } from "../types/LearningEvent";
import { EncryptedEventEnvelope, EvidencePrivateKey } from "../types/Evidence";
import { canonicalJson, parseJsonLines } from "../utils/json";
import { sha256 } from "../utils/crypto";
import { EvidenceCryptoService } from "./EvidenceCryptoService";

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
  constructor(private readonly evidence = new EvidenceCryptoService()) {}

  verify(content: string, privateKey?: EvidencePrivateKey): IntegrityResult {
    if (!content.trim()) {
      return {
        status: "not_available",
        checkedEntries: 0,
        message: "No event chain is available"
      };
    }
    const parsed = parseJsonLines<LearningEvent | EncryptedEventEnvelope>(content);
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
      const raw = parsed.values[index];
      if (this.isEncryptedEvent(raw)) {
        if (!privateKey) {
          return {
            status: "incomplete",
            checkedEntries: index,
            firstInvalidLine: index + 1,
            message: "Encrypted event chain requires the teacher private key"
          };
        }
        const withoutHash = this.evidence.decryptJson<Omit<LearningEvent, "hash">>(raw.data, privateKey);
        const calculated = sha256(
          `${previousHash === null ? "" : previousHash}${canonicalJson(withoutHash)}`
        );
        if (withoutHash.previousHash !== previousHash || calculated !== raw.hash) {
          return {
            status: "invalid",
            checkedEntries: index,
            firstInvalidLine: index + 1,
            message: `Encrypted hash-chain mismatch at line ${index + 1}`
          };
        }
        previousHash = raw.hash;
        continue;
      }
      const event = raw as LearningEvent;
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

  private isEncryptedEvent(value: unknown): value is EncryptedEventEnvelope {
    const event = value as Partial<EncryptedEventEnvelope>;
    return event?.schema === "vsc4e.event.encrypted.v1" && event.data?.encrypted === true;
  }
}
