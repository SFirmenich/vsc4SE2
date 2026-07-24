import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { ActivityManifest, ActivityTask } from '../types/ActivityManifest';
import { copyDirectory, ensureDirectory, pathExists, readJson, writeJson } from '../utils/fs';
import { activityConfigurationPath, learningPath, manifestPath } from '../utils/paths';
import { GitService } from './GitService';
import { ZipService } from './ZipService';

export interface LoadedActivity {
	root: string;
	manifest: ActivityManifest;
	gitAvailable: boolean;
	repositoryMode: 'disabled' | 'created' | 'existing';
}

export class ActivityLoader {
	public constructor(private readonly zipService: ZipService) {}

	public async load(
		zipPath: string,
		destination: string,
		enableGit: boolean
	): Promise<LoadedActivity> {
		const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'learning-activity-'));
		try {
			await this.zipService.extract(zipPath, temporaryDirectory);
			const packageRoot = await this.findPackageRoot(temporaryDirectory);
			const rawManifest = await readJson<unknown>(path.join(packageRoot, 'manifest.json'));
			const manifest = this.normalizeManifest(rawManifest);

			await ensureDirectory(destination);
			await this.copyStarter(packageRoot, destination);
			await copyDirectory(packageRoot, learningPath(destination));

			const gitService = new GitService(destination);
			const gitAvailable = enableGit && await gitService.isGitInstalled();
			const repositoryExisted = gitAvailable && await gitService.isRepository();
			await writeJson(manifestPath(destination), manifest);
			const configuration = {
				loadedAt: new Date().toISOString(),
				gitEnabled: gitAvailable,
				repositoryMode: gitAvailable
					? repositoryExisted ? 'existing' as const : 'created' as const
					: 'disabled' as const,
				repository: manifest.repository
			};
			await writeJson(activityConfigurationPath(destination), configuration);
			if (gitAvailable) {
				await gitService.prepareActivityRepository();
			}

			return {
				root: destination,
				manifest,
				gitAvailable,
				repositoryMode: configuration.repositoryMode
			};
		} finally {
			await fs.rm(temporaryDirectory, { recursive: true, force: true });
		}
	}

	private async findPackageRoot(extractedRoot: string): Promise<string> {
		if (await pathExists(path.join(extractedRoot, 'manifest.json'))) {
			return extractedRoot;
		}
		const entries = await fs.readdir(extractedRoot, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isDirectory()) {
				const candidate = path.join(extractedRoot, entry.name);
				if (await pathExists(path.join(candidate, 'manifest.json'))) {
					return candidate;
				}
			}
		}
		throw new Error('The ZIP does not contain manifest.json at its root.');
	}

	private async copyStarter(packageRoot: string, destination: string): Promise<void> {
		await ensureDirectory(path.join(destination, 'src'));

		const legacyStarter = path.join(packageRoot, 'starter', 'proyecto-base');
		if (await pathExists(legacyStarter)) {
			await copyDirectory(legacyStarter, destination);
			return;
		}

		await copyDirectory(path.join(packageRoot, 'starter'), path.join(destination, 'src'));
	}

	private normalizeManifest(value: unknown): ActivityManifest {
		if (!value || typeof value !== 'object') {
			throw new Error('manifest.json must contain a JSON object.');
		}
		const manifest = value as Record<string, unknown>;
		if (typeof manifest.id !== 'string' || typeof manifest.title !== 'string') {
			throw new Error('manifest.json requires string fields "id" and "title".');
		}
		this.validateIdentifier(manifest.id, 'The activity identifier');
		if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0) {
			throw new Error('manifest.json requires at least one task.');
		}
		const tasks = manifest.tasks.map((task, index) => this.normalizeTask(task, index));
		if (new Set(tasks.map(task => task.id)).size !== tasks.length) {
			throw new Error('Task identifiers must be unique.');
		}
		return {
			id: manifest.id,
			title: manifest.title,
			description: typeof manifest.description === 'string' ? manifest.description : undefined,
			version: typeof manifest.version === 'string' ? manifest.version : undefined,
			repository: this.normalizeRepository(manifest.repository),
			tasks
		};
	}

	private normalizeRepository(value: unknown): ActivityManifest['repository'] {
		if (!value || typeof value !== 'object') {
			return undefined;
		}
		const repository = value as Record<string, unknown>;
		const raw = repository.eventServer;
		if (!raw || typeof raw !== 'object') {
			return undefined;
		}
		const eventServer = raw as Record<string, unknown>;
		if (eventServer.enabled !== true || typeof eventServer.baseUrl !== 'string') {
			return undefined;
		}
		return {
			eventServer: {
				enabled: true,
				baseUrl: eventServer.baseUrl.replace(/\/+$/, ''),
				activityVersionId: typeof eventServer.activityVersionId === 'number' ? eventServer.activityVersionId : undefined,
				ingestionToken: typeof eventServer.ingestionToken === 'string' ? eventServer.ingestionToken : undefined,
				publicSigningKeyUrl: typeof eventServer.publicSigningKeyUrl === 'string' ? eventServer.publicSigningKeyUrl : undefined,
				expectedSigningKeyId: typeof eventServer.expectedSigningKeyId === 'string' ? eventServer.expectedSigningKeyId : undefined,
				expectedPublicKeySha256: typeof eventServer.expectedPublicKeySha256 === 'string' ? eventServer.expectedPublicKeySha256 : undefined,
				publicSigningKey: eventServer.publicSigningKey && typeof eventServer.publicSigningKey === 'object'
					? eventServer.publicSigningKey as Record<string, unknown>
					: undefined,
				requireReceipts: eventServer.requireReceipts === true
			}
		};
	}

	private normalizeTask(value: unknown, index: number): ActivityTask {
		if (typeof value === 'string') {
			return { id: value, title: value };
		}
		if (!value || typeof value !== 'object') {
			throw new Error(`The task at position ${index} is not valid.`);
		}
		const task = value as Record<string, unknown>;
		if (typeof task.id !== 'string' || typeof task.title !== 'string') {
			throw new Error(`The task at position ${index} requires "id" and "title".`);
		}
		this.validateIdentifier(task.id, `The task identifier at position ${index}`);
		return {
			id: task.id,
			title: task.title,
			description: typeof task.description === 'string' ? task.description : undefined,
			file: typeof task.file === 'string' ? task.file : undefined
		};
	}

	private validateIdentifier(identifier: string, label: string): void {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(identifier)) {
			throw new Error(
				`${label} can only contain letters, numbers, dots, hyphens, and underscores.`
			);
		}
	}
}
