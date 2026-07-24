import { createCipheriv, createPublicKey, JsonWebKey, publicEncrypt, randomBytes } from 'crypto';
import * as path from 'path';

import { EncryptedPayload, EvidencePublicKey } from '../types/Evidence';
import { pathExists, readJson } from '../utils/fs';
import { learningPath } from '../utils/paths';

export class EvidenceEncryptionService {
	private publicKey: EvidencePublicKey | undefined;

	public constructor(private readonly root: string) {}

	public async isAvailable(): Promise<boolean> {
		return (await this.loadPublicKey()) !== undefined;
	}

	public async keyId(): Promise<string | undefined> {
		return (await this.loadPublicKey())?.kid;
	}

	public async encryptJson(value: unknown): Promise<EncryptedPayload> {
		const jwk = await this.loadPublicKey();
		if (!jwk) {
			throw new Error('The activity does not contain signatures/evidence-public-key.jwk.');
		}
		const contentKey = randomBytes(32);
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', contentKey, iv);
		const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
		const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
		const tag = cipher.getAuthTag();
		const publicKey = createPublicKey({ key: jwk as unknown as JsonWebKey, format: 'jwk' });
		const encryptedKey = publicEncrypt(
			{ key: publicKey, oaepHash: 'sha256' },
			contentKey
		);
		return {
			encrypted: true,
			alg: 'RSA-OAEP-256+A256GCM',
			iv: iv.toString('base64'),
			encryptedKey: encryptedKey.toString('base64'),
			ciphertext: ciphertext.toString('base64'),
			tag: tag.toString('base64')
		};
	}

	private async loadPublicKey(): Promise<EvidencePublicKey | undefined> {
		if (this.publicKey) {
			return this.publicKey;
		}
		const target = learningPath(this.root, 'signatures', 'evidence-public-key.jwk');
		if (!await pathExists(target)) {
			return undefined;
		}
		const value = await readJson<EvidencePublicKey>(target);
		if (value.kty !== 'RSA' || value.alg !== 'RSA-OAEP-256' || !value.kid) {
			throw new Error(`Invalid evidence public key: ${path.relative(this.root, target)}`);
		}
		this.publicKey = value;
		return value;
	}
}
