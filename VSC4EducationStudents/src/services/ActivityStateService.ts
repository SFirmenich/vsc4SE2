import { ActivityManifest } from '../types/ActivityManifest';
import { ActivityState } from '../types/ActivityState';
import { StudentProfile } from '../types/StudentProfile';
import { ensureDirectory, pathExists, readJson, writeJson } from '../utils/fs';
import { contributionPath, statePath } from '../utils/paths';

export class ActivityStateService {
	private static readonly queues = new Map<string, Promise<unknown>>();

	public constructor(
		public readonly root: string,
		public readonly profile: StudentProfile
	) {}

	public async exists(): Promise<boolean> {
		return pathExists(statePath(this.root, this.profile.contributionId));
	}

	public async load(): Promise<ActivityState> {
		if (!await this.exists()) {
			throw new Error('No hay una actividad cargada en este workspace.');
		}
		return readJson<ActivityState>(statePath(this.root, this.profile.contributionId));
	}

	public async create(manifest: ActivityManifest, gitEnabled: boolean): Promise<ActivityState> {
		await ensureDirectory(contributionPath(
			this.root,
			this.profile.contributionId,
			'task-metadata'
		));
		const state: ActivityState = {
			studentId: this.profile.studentId,
			contributionId: this.profile.contributionId,
			activityId: manifest.id,
			activityTitle: manifest.title,
			loadedAt: new Date().toISOString(),
			currentTaskId: null,
			tasks: Object.fromEntries(manifest.tasks.map(task => [
				task.id,
				{ status: 'pending' }
			])),
			lastEventHash: null,
			git: { enabled: gitEnabled }
		};
		await this.save(state);
		return state;
	}

	public async save(state: ActivityState): Promise<void> {
		await writeJson(statePath(this.root, this.profile.contributionId), state);
	}

	public async update(
		updater: (state: ActivityState) => void | ActivityState
	): Promise<ActivityState> {
		return this.withLock(state => {
			const updated = updater(state) ?? state;
			return { state: updated, result: updated };
		});
	}

	public async withLock<T>(
		operation: (state: ActivityState) => Promise<{ state: ActivityState; result: T }> | {
			state: ActivityState;
			result: T;
		}
	): Promise<T> {
		const queueKey = `${this.root}:${this.profile.contributionId}`;
		const previous = ActivityStateService.queues.get(queueKey) ?? Promise.resolve();
		const current = previous.catch(() => undefined).then(async () => {
			const state = await this.load();
			const outcome = await operation(state);
			await this.save(outcome.state);
			return outcome.result;
		});
		ActivityStateService.queues.set(queueKey, current);
		try {
			return await current;
		} finally {
			if (ActivityStateService.queues.get(queueKey) === current) {
				ActivityStateService.queues.delete(queueKey);
			}
		}
	}
}
