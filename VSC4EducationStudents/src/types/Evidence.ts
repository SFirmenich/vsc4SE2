export interface EvidencePublicKey {
	kty: string;
	kid: string;
	use: 'enc';
	alg: 'RSA-OAEP-256';
	n: string;
	e: string;
}

export interface EncryptedPayload {
	encrypted: true;
	alg: 'RSA-OAEP-256+A256GCM';
	iv: string;
	encryptedKey: string;
	ciphertext: string;
	tag: string;
}

export interface EncryptedEventEnvelope {
	id: string;
	schema: 'vsc4e.event.encrypted.v1';
	keyId: string;
	data: EncryptedPayload;
	hash: string;
}

export interface AgentEvidenceEntry {
	id: string;
	schema: 'vsc4e.agent-evidence.encrypted.v1';
	source: 'agent-interactions.jsonl';
	sourceLine: number;
	keyId: string;
	plaintextHash: string;
	data: EncryptedPayload;
	previousHash: string | null;
	hash: string;
}
