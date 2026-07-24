import { createHash, createPublicKey, verify } from "crypto";

import { ActivityManifest } from "../types/ActivityManifest";
import { LearningEvent } from "../types/LearningEvent";
import { canonicalJson } from "../utils/json";

export interface ExternalIntegrityResult {
  status: "valid" | "partial" | "invalid" | "unverified" | "not_available";
  checkedReceipts: number;
  invalidReceipts?: number;
  anchoredEvents: number;
  firstServerSeenAt?: string;
  lastServerSeenAt?: string;
  message: string;
}

export class ExternalIntegrityService {
  verify(events: LearningEvent[], manifest: ActivityManifest): ExternalIntegrityResult {
    const receiptEvents = events.filter((event) =>
      event.event === "event_server_receipt" && typeof event.data === "object" && event.data !== null
    );
    if (!receiptEvents.length) {
      return {
        status: "not_available",
        checkedReceipts: 0,
        anchoredEvents: 0,
        message: "No Repository event receipts are present"
      };
    }
    const eventServer = manifest.repository?.eventServer;
    const publicKey = eventServer?.publicSigningKey;
    if (!publicKey) {
      return {
        status: "unverified",
        checkedReceipts: receiptEvents.length,
        anchoredEvents: new Set(receiptEvents.map((event) => event.data?.anchoredEventHash)).size,
        message: "Repository receipts are present, but the activity manifest does not include a pinned public signing key"
      };
    }
    if (
      eventServer.expectedPublicKeySha256 &&
      this.sha256(canonicalJson(publicKey)) !== eventServer.expectedPublicKeySha256
    ) {
      return {
        status: "invalid",
        checkedReceipts: receiptEvents.length,
        anchoredEvents: 0,
        message: "The Repository public signing key does not match the pinned fingerprint"
      };
    }
    let checked = 0;
    let invalid = 0;
    let firstServerSeenAt: string | undefined;
    let lastServerSeenAt: string | undefined;
    const anchored = new Set<unknown>();
    for (const event of receiptEvents) {
      const data = event.data ?? {};
      const receipt = data.receipt as Record<string, unknown> | undefined;
      const payload = receipt?.payload as Record<string, unknown> | undefined;
      const signature = receipt?.signature;
      if (!payload || typeof signature !== "string") {
        invalid += 1;
        continue;
      }
      if (eventServer.expectedSigningKeyId && receipt?.signingKeyId !== eventServer.expectedSigningKeyId) {
        invalid += 1;
        continue;
      }
      if (payload.eventHash !== data.anchoredEventHash || !this.verifySignature(publicKey, payload, signature)) {
        invalid += 1;
        continue;
      }
      checked += 1;
      anchored.add(payload.eventHash);
      if (typeof payload.serverReceivedAt === "string") {
        firstServerSeenAt = firstServerSeenAt ? [firstServerSeenAt, payload.serverReceivedAt].sort()[0] : payload.serverReceivedAt;
        lastServerSeenAt = lastServerSeenAt ? [lastServerSeenAt, payload.serverReceivedAt].sort()[1] : payload.serverReceivedAt;
      }
    }
    const status = invalid === 0 && checked > 0 ? "valid" : checked > 0 ? "partial" : "invalid";
    return {
      status,
      checkedReceipts: checked,
      invalidReceipts: invalid,
      anchoredEvents: anchored.size,
      firstServerSeenAt,
      lastServerSeenAt,
      message: status === "valid"
        ? "Repository receipts validate against the pinned public key"
        : "Some Repository receipts could not be verified"
    };
  }

  private verifySignature(publicJwk: Record<string, unknown>, payload: Record<string, unknown>, signature: string): boolean {
    try {
      const key = createPublicKey({ key: publicJwk, format: "jwk" });
      return verify(null, Buffer.from(canonicalJson(payload), "utf8"), key, Buffer.from(signature, "base64"));
    } catch {
      return false;
    }
  }

  private sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }
}
