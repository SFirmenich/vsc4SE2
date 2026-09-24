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
			.map(line => this.parseLine(line))
			.filter((event): event is LearningEvent => !!event && typeof event.event === 'string');
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
			.map(line => this.parseLine(line))
			.filter((event): event is LearningEvent => !!event);
	}

	/**
	 * Parses a single line of events.jsonl, tolerating a malformed line instead of
	 * throwing. A line can be left truncated on disk if the process was interrupted
	 * mid-write (VS Code closed abruptly, OS crash, antivirus/sync lock, etc.).
	 *
	 * This only affects what is read back into memory for display/context purposes;
	 * events.jsonl itself is never rewritten here. The evidentiary hash chain is not
	 * at risk from a skipped line: `state.lastEventHash` (the source of the next
	 * event's `previousHash`, see appendImmediately below) is only advanced *after*
	 * a write to this file has fully completed, so a truncated trailing line was
	 * never adopted into the chain in the first place — it is safe to ignore.
	 */
	private parseLine(line: string): LearningEvent | undefined {
		try {
			return JSON.parse(line) as LearningEvent;
		} catch {
			return undefined;
		}
	}

	private async appendImmediately(input: LearningEventInput): Promise<LearningEvent> {
		const { event, envelope, shouldAnchor } = await this.stateService.withLock(async state => {
			// `state.lastEventHash` (persisted in state.json, not re-derived from
			// events.jsonl) is always the hash of the last event that was fully
			// appended AND committed below. It is only ever advanced after the
			// `fs.appendFile` call below resolves, and `state.json` is only saved
			// once this whole callback returns (see ActivityStateService.withLock).
			// So if a previous append was interrupted mid-write (leaving a
			// truncated trailing line in events.jsonl), `state.lastEventHash` was
			// never advanced past the last *good* event, and this new event's
			// `previousHash` correctly chains from that last good event, ignoring
			// whatever partial bytes were left behind.
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
			// Leading newline defensively separates this entry from any truncated
			// trailing bytes a previous interrupted write may have left behind
			// (so this event's own line stays independently parseable even if the
			// one before it was torn mid-write). Readers already ignore blank
			// lines, so this is harmless on a clean file.
			await fs.appendFile(
				eventsPath(
					this.stateService.root,
					this.stateService.profile.contributionId
				),
				`\n${JSON.stringify(envelope)}\n`,
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
