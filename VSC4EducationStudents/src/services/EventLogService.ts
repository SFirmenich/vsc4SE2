import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';

import { LearningEvent, LearningEventInput } from '../types/LearningEvent';
import { createEventHash } from '../utils/crypto';
import { ensureDirectory, pathExists } from '../utils/fs';
import { contributionPath, eventsPath } from '../utils/paths';
import { ActivityStateService } from './ActivityStateService';

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
			.map(line => JSON.parse(line) as LearningEvent);
	}

	public async count(eventName: string, taskId?: string): Promise<number> {
		const events = await this.getAll();
		return events.filter(event =>
			event.event === eventName && (taskId === undefined || event.taskId === taskId)
		).length;
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
		return this.stateService.withLock(async state => {
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

			await ensureDirectory(contributionPath(
				this.stateService.root,
				this.stateService.profile.contributionId
			));
			await fs.appendFile(
				eventsPath(
					this.stateService.root,
					this.stateService.profile.contributionId
				),
				`${JSON.stringify(event)}\n`,
				'utf8'
			);
			state.lastEventHash = event.hash;
			return { state, result: event };
		});
	}
}
