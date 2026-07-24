import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  JsonWebKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  randomUUID
} from "crypto";
import * as path from "path";
import { EncryptedPayload, EvidencePrivateKey, EvidencePublicKey } from "../types/Evidence";
import { pathExists, readJson, writeJson } from "../utils/fs";

export const EVIDENCE_PUBLIC_KEY_PATH = path.join("signatures", "evidence-public-key.jwk");
export const EVIDENCE_PRIVATE_KEY_PATH = path.join("teacher-private", "evidence-private-key.jwk");

export class EvidenceCryptoService {
  async ensureKeyPair(activityRoot: string): Promise<{ publicKey: EvidencePublicKey; privateKey: EvidencePrivateKey }> {
    const publicPath = path.join(activityRoot, EVIDENCE_PUBLIC_KEY_PATH);
    const privatePath = path.join(activityRoot, EVIDENCE_PRIVATE_KEY_PATH);
    if ((await pathExists(publicPath)) && (await pathExists(privatePath))) {
      return {
        publicKey: await readJson<EvidencePublicKey>(publicPath),
        privateKey: await readJson<EvidencePrivateKey>(privatePath)
      };
    }
    const { publicKey, privateKey } = (generateKeyPairSync as unknown as (type: string, options: unknown) => unknown)("rsa", {
      modulusLength: 3072,
      publicKeyEncoding: { format: "jwk" },
      privateKeyEncoding: { format: "jwk" }
    }) as unknown as { publicKey: EvidencePublicKey; privateKey: EvidencePrivateKey };
    const kid = `vsc4e-${randomUUID()}`;
    const normalizedPublic = { ...publicKey, kid, use: "enc" as const, alg: "RSA-OAEP-256" as const };
    const normalizedPrivate = { ...privateKey, kid, use: "enc" as const, alg: "RSA-OAEP-256" as const };
    await writeJson(publicPath, normalizedPublic);
    await writeJson(privatePath, normalizedPrivate);
    return { publicKey: normalizedPublic, privateKey: normalizedPrivate };
  }

  async findPrivateKey(start: string): Promise<EvidencePrivateKey | undefined> {
    const candidates = [
      path.join(start, EVIDENCE_PRIVATE_KEY_PATH),
      path.join(start, ".vsc4education", EVIDENCE_PRIVATE_KEY_PATH),
      path.join(path.dirname(start), "learning-activity-definition", EVIDENCE_PRIVATE_KEY_PATH)
    ];
    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        return readJson<EvidencePrivateKey>(candidate);
      }
    }
    return undefined;
  }

  encryptJson(value: unknown, publicKey: EvidencePublicKey): EncryptedPayload {
    const contentKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", contentKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(value), "utf8")),
      cipher.final()
    ]);
    const encryptedKey = publicEncrypt(
      { key: createPublicKey({ key: publicKey as unknown as JsonWebKey, format: "jwk" }), oaepHash: "sha256" },
      contentKey
    );
    return {
      encrypted: true,
      alg: "RSA-OAEP-256+A256GCM",
      iv: iv.toString("base64"),
      encryptedKey: encryptedKey.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: cipher.getAuthTag().toString("base64")
    };
  }

  decryptJson<T>(payload: EncryptedPayload, privateKey: EvidencePrivateKey): T {
    const contentKey = privateDecrypt(
      { key: createPrivateKey({ key: privateKey as unknown as JsonWebKey, format: "jwk" }), oaepHash: "sha256" },
      Buffer.from(payload.encryptedKey, "base64")
    );
    const decipher = createDecipheriv("aes-256-gcm", contentKey, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final()
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  }
}
