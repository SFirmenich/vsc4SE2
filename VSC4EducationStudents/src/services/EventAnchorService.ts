import { randomUUID } from 'crypto';

import { RepositoryEventServerConfiguration } from '../types/ActivityManifest';
import { LearningEvent } from '../types/LearningEvent';
import { StudentProfile } from '../types/StudentProfile';
import { sha256 } from '../utils/crypto';
import { pathExists, readJson, writeJson } from '../utils/fs';
import { canonicalJson } from '../utils/json';
import { activityConfigurationPath, contributionPath, manifestPath } from '../utils/paths';
import { ActivityConfiguration } from '../types/ActivityConfiguration';
import { ActivityManifest } from '../types/ActivityManifest';

interface EventServerSessionState {
	clientSessionId: string;
	sessionId?: number;
	sessionToken?: string;
}

export interface EventServerReceiptEventData {
	anchoredEventId: string;
	anchoredEventHash: string;
	repositoryBaseUrl: string;
	serverReceivedAt?: string;
	signingKeyId?: string;
	receiptSignature?: string;
	receiptPayloadHash?: string;
	receipt?: Record<string, unknown>;
}

export class EventAnchorService {
	public constructor(
		private readonly root: string,
		private readonly profile: StudentProfile
	) {}

	public async anchor(event: LearningEvent, envelope: unknown): Promise<EventServerReceiptEventData | undefined> {
		const configuration = await this.eventServerConfiguration();
		if (!configuration?.enabled || !configuration.ingestionToken) {
			return undefined;
		}
		const session = await this.ensureSession(configuration);
		if (!session.sessionId || !session.sessionToken) {
			return undefined;
		}
		const response = await fetch(`${configuration.baseUrl}/api/integration/student/event-sessions/${session.sessionId}/receipts/`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-VSC4E-Session-Token': session.sessionToken
			},
			body: JSON.stringify({
				events: [{
					id: event.id,
					timestamp: event.timestamp,
					previousHash: event.previousHash,
					hash: event.hash,
					envelopeSha256: sha256(canonicalJson(envelope))
				}]
			})
		});
		if (!response.ok) {
			return undefined;
		}
		const body = await response.json() as { receipts?: Array<Record<string, unknown>> };
		const receipt = body.receipts?.[0];
		if (!receipt) {
			return undefined;
		}
		return {
			anchoredEventId: event.id,
			anchoredEventHash: event.hash,
			repositoryBaseUrl: configuration.baseUrl,
			serverReceivedAt: typeof receipt.serverReceivedAt === 'string' ? receipt.serverReceivedAt : undefined,
			signingKeyId: typeof receipt.signingKeyId === 'string' ? receipt.signingKeyId : undefined,
			receiptSignature: typeof receipt.signature === 'string' ? receipt.signature : undefined,
			receiptPayloadHash: sha256(canonicalJson(receipt.payload ?? {})),
			receipt
		};
	}

	private async eventServerConfiguration(): Promise<RepositoryEventServerConfiguration | undefined> {
		const configuration = await readJson<ActivityConfiguration>(activityConfigurationPath(this.root));
		const manifest = await readJson<ActivityManifest>(manifestPath(this.root));
		const eventServer = configuration.repository?.eventServer ?? manifest.repository?.eventServer;
		if (!eventServer?.enabled || !eventServer.baseUrl) {
			return undefined;
		}
		return {
			...eventServer,
			baseUrl: eventServer.baseUrl.replace(/\/+$/, '')
		};
	}

	private async ensureSession(configuration: RepositoryEventServerConfiguration): Promise<EventServerSessionState> {
		const statePath = this.sessionStatePath();
		let state: EventServerSessionState = await pathExists(statePath)
			? await readJson<EventServerSessionState>(statePath)
			: { clientSessionId: randomUUID() };
		if (state.sessionId && state.sessionToken) {
			return state;
		}
		const manifest = await readJson<ActivityManifest>(manifestPath(this.root));
		const response = await fetch(`${configuration.baseUrl}/api/integration/student/event-sessions/`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-VSC4E-Ingestion-Token': configuration.ingestionToken ?? ''
			},
			body: JSON.stringify({
				activityId: manifest.id,
				version: manifest.version ?? '',
				studentId: this.profile.studentId,
				displayName: this.profile.displayName,
				contributionId: this.profile.contributionId,
				clientSessionId: state.clientSessionId
			})
		});
		if (!response.ok) {
			return state;
		}
		const body = await response.json() as { sessionId?: number; sessionToken?: string };
		if (typeof body.sessionId === 'number' && typeof body.sessionToken === 'string' && body.sessionToken) {
			state = {
				...state,
				sessionId: body.sessionId,
				sessionToken: body.sessionToken
			};
			await writeJson(statePath, state);
		}
		return state;
	}

	private sessionStatePath(): string {
		return contributionPath(this.root, this.profile.contributionId, 'event-server-session.json');
	}
}
