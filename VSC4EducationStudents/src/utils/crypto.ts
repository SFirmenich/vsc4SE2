import { createHash } from 'crypto';

import { canonicalJson } from './json';

export function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createEventHash(
	previousHash: string | null,
	eventWithoutHash: unknown
): string {
	return sha256((previousHash ?? '') + canonicalJson(eventWithoutHash));
}
