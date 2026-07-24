import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';

import { LearningEvent, LearningEventInput } from '../types/LearningEvent';
import { EncryptedEventEnvelope } from '../types/Evidence';
import { createEventHash } from '../utils/crypto';
import { ensureDirectory, pathExists } from '../utils/fs';
import { contributionPath, eventsPath } from '../utils/paths';
import { ActivityStateService } from './ActivityStateService';
import { EvidenceEncryptionService } from './EvidenceEncryptionService';
import { EventAnchorService } from './EventAnchorService';
import { shouldAnchorInRepository } from './EventAnchorPolicy';

export class EventLogService {
	public constructor(
		private readonly stateService: ActivityStateService
	) {}

	public append(input: LearningEventInput): Promise<LearningEvent> {
		return this.appendImmediately(input);
	}

	public async getRecent(limit = 20): Promise<LearningEvent[]> {
		const filePath = eventsPath(
			this.stateService.root,
			this.stateService.profile.contributionId
		);
		if (!await pathExists(filePath)) {
			return [];
		}
		const content = await fs.readFile(filePath, 'utf8');
		return content
			.split(/\r?\n/)
			.filter(Boolean)
			.slice(-limit)
			.map(line => JSON.parse(line) as LearningEvent)
			.filter(event => typeof event.event === 'string');
	}

	public async count(eventName: string, taskId?: string): Promise<number> {
		const state = await this.stateService.load();
		const key = this.countKey(eventName, taskId);
		return state.eventCounts?.[key] ?? 0;
	}

	private async getAll(): Promise<LearningEvent[]> {
		const filePath = eventsPath(
			this.stateService.root,
			this.stateService.profile.contributionId
		);
		if (!await pathExists(filePath)) {
			return [];
		}
		const content = await fs.readFile(filePath, 'utf8');
		return content
			.split(/\r?\n/)
			.filter(Boolean)
			.map(line => JSON.parse(line) as LearningEvent);
	}

	private async appendImmediately(input: LearningEventInput): Promise<LearningEvent> {
		const { event, envelope, shouldAnchor } = await this.stateService.withLock(async state => {
			const eventWithoutHash = {
				id: randomUUID(),
				studentId: this.stateService.profile.studentId,
				timestamp: new Date().toISOString(),
				event: input.event,
				taskId: input.taskId ?? state.currentTaskId,
				data: input.data ?? {},
				previousHash: state.lastEventHash
			};
			const event: LearningEvent = {
				...eventWithoutHash,
				hash: createEventHash(state.lastEventHash, eventWithoutHash)
			};
			const encryption = new EvidenceEncryptionService(this.stateService.root);
			const keyId = await encryption.keyId();
			if (!keyId) {
				throw new Error('The activity is missing signatures/evidence-public-key.jwk.');
			}
			const envelope: EncryptedEventEnvelope = {
				id: event.id,
				schema: 'vsc4e.event.encrypted.v1',
				keyId,
				data: await encryption.encryptJson(eventWithoutHash),
				hash: event.hash
			};

			await ensureDirectory(contributionPath(
				this.stateService.root,
				this.stateService.profile.contributionId
			));
			await fs.appendFile(
				eventsPath(
					this.stateService.root,
					this.stateService.profile.contributionId
				),
				`${JSON.stringify(envelope)}\n`,
				'utf8'
			);
			state.lastEventHash = event.hash;
			state.eventCounts = {
				...(state.eventCounts ?? {}),
				[this.countKey(event.event, event.taskId)]: (state.eventCounts?.[this.countKey(event.event, event.taskId)] ?? 0) + 1,
				[this.countKey(event.event)]: (state.eventCounts?.[this.countKey(event.event)] ?? 0) + 1
			};
			return {
				state,
				result: {
					event,
					envelope,
					shouldAnchor: shouldAnchorInRepository(event.event, state)
				}
			};
		});
		if (shouldAnchor) {
			await this.appendServerReceiptEvent(event, envelope);
		}
		return event;
	}

	private async appendServerReceiptEvent(event: LearningEvent, envelope: EncryptedEventEnvelope): Promise<void> {
		try {
			const receipt = await new EventAnchorService(
				this.stateService.root,
				this.stateService.profile
			).anchor(event, envelope);
			if (receipt) {
				await this.appendImmediately({
					event: 'event_server_receipt',
					taskId: event.taskId,
					data: { ...receipt }
				});
			}
		} catch {
			// Event anchoring is best-effort; the local encrypted hash chain remains the primary offline evidence.
		}
	}

	private countKey(eventName: string, taskId?: string | null): string {
		return taskId ? `${eventName}:${taskId}` : eventName;
	}
}
