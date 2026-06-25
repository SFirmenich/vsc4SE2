import { ActivityConfiguration } from '../types/ActivityConfiguration';
import { ActivityManifest } from '../types/ActivityManifest';
import { ActivityState } from '../types/ActivityState';
import { LearningEvent } from '../types/LearningEvent';
import { StudentProfile } from '../types/StudentProfile';
import { TaskMetadata } from '../types/TaskMetadata';
import { pathExists, readJson, writeJson } from '../utils/fs';
import {
	activityConfigurationPath,
	contributionPath,
	learningPath,
	manifestPath
} from '../utils/paths';
import { ActivityStateService } from './ActivityStateService';
import { AgentInstructionsService } from './AgentInstructionsService';
import { EventLogService } from './EventLogService';
import { GitService } from './GitService';
import { StudentProfileService } from './StudentProfileService';

export interface ActivitySnapshot {
	root: string;
	manifest: ActivityManifest;
	profile?: StudentProfile;
	state?: ActivityState;
	recentEvents: LearningEvent[];
	gitStatus: string;
}

interface StudentContext {
	root: string;
	profile: StudentProfile;
	stateService: ActivityStateService;
	eventLog: EventLogService;
}

export class LearningActivityService {
	private root: string | undefined;
	private readonly resumedRoots = new Set<string>();
	private listeners = new Set<() => void>();
	private exportInProgress = false;

	public constructor(private readonly profiles: StudentProfileService) {}

	public setRoot(root: string): void {
		this.root = root;
		this.notifyChanged();
	}

	public clearRoot(): void {
		this.root = undefined;
		this.notifyChanged();
	}

	public getRoot(): string | undefined {
		return this.root;
	}

	public async useRootIfActivity(root: string): Promise<boolean> {
		if (await pathExists(manifestPath(root))) {
			this.setRoot(root);
			await this.resumeExistingActivity(root);
			return true;
		}
		return false;
	}

	private async resumeExistingActivity(root: string): Promise<void> {
		if (this.resumedRoots.has(root)) {
			return;
		}
		let configuration: ActivityConfiguration;
		if (await pathExists(activityConfigurationPath(root))) {
			configuration = await readJson<ActivityConfiguration>(
				activityConfigurationPath(root)
			);
		} else {
			const git = new GitService(root);
			const gitEnabled = await git.isGitInstalled() && await git.isRepository();
			configuration = {
				loadedAt: new Date().toISOString(),
				gitEnabled,
				repositoryMode: gitEnabled ? 'existing' : 'disabled'
			};
			await writeJson(activityConfigurationPath(root), configuration);
		}

		if (configuration.gitEnabled) {
			const git = new GitService(root);
			if (!await git.isGitInstalled()) {
				configuration.gitEnabled = false;
				configuration.repositoryMode = 'disabled';
				await writeJson(activityConfigurationPath(root), configuration);
			} else if (!await git.isRepository()) {
				configuration.repositoryMode = 'created';
				await writeJson(activityConfigurationPath(root), configuration);
				await git.prepareActivityRepository();
			}
		}

		const profile = await this.profiles.getActive(root);
		if (!profile) {
			this.resumedRoots.add(root);
			return;
		}
		const stateService = new ActivityStateService(root, profile);
		if (!await stateService.exists()) {
			this.resumedRoots.add(root);
			return;
		}
		if (configuration.gitEnabled) {
			await new GitService(root).configureStudentIdentity(
				profile.displayName,
				profile.studentId
			);
		}
		const eventLog = new EventLogService(stateService);
		await eventLog.append({
			event: 'student_session_started',
			data: { reason: 'workspace_opened' }
		});
		await new AgentInstructionsService(root, profile).generate(
			await readJson<ActivityManifest>(manifestPath(root)),
			await stateService.load(),
			await eventLog.getRecent()
		);
		this.resumedRoots.add(root);
	}

	public onDidChange(listener: () => void): { dispose(): void } {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}

	public async registerStudent(
		input: Pick<StudentProfile, 'studentId' | 'firstName' | 'lastName'>
	): Promise<StudentProfile> {
		const root = this.requireRoot();
		const manifest = await readJson<ActivityManifest>(manifestPath(root));
		const configuration = await readJson<ActivityConfiguration>(
			activityConfigurationPath(root)
		);
		const profile = await this.profiles.register(root, input);
		const stateService = new ActivityStateService(root, profile);
		const isNew = !await stateService.exists();
		if (isNew) {
			const state = await stateService.create(manifest, configuration.gitEnabled);
			if (configuration.gitEnabled) {
				state.git.initialCommit = await new GitService(root).getCurrentCommitHash();
			}
			await stateService.save(state);
		}
		if (configuration.gitEnabled) {
			await new GitService(root).configureStudentIdentity(
				profile.displayName,
				profile.studentId
			);
		}
		const eventLog = new EventLogService(stateService);
		if (isNew) {
			await eventLog.append({
				event: 'activity_loaded',
				data: { activityId: manifest.id }
			});
		}
		await eventLog.append({
			event: isNew ? 'student_registered' : 'student_session_started',
			data: {
				displayName: profile.displayName,
				contributionId: profile.contributionId
			}
		});
		await new AgentInstructionsService(root, profile).generate(
			manifest,
			await stateService.load(),
			await eventLog.getRecent()
		);
		this.notifyChanged();
		return profile;
	}

	public async getActiveProfile(): Promise<StudentProfile | undefined> {
		return this.root ? this.profiles.getActive(this.root) : undefined;
	}

	public async getSnapshot(): Promise<ActivitySnapshot | undefined> {
		if (!this.root || !await pathExists(manifestPath(this.root))) {
			return undefined;
		}
		const manifest = await readJson<ActivityManifest>(manifestPath(this.root));
		const profile = await this.profiles.getActive(this.root);
		const configuration = await readJson<ActivityConfiguration>(
			activityConfigurationPath(this.root)
		);
		let gitStatus = configuration.gitEnabled ? 'Sin cambios' : 'Git deshabilitado';
		if (configuration.gitEnabled) {
			try {
				gitStatus = (await new GitService(this.root).getStatus()) || 'Sin cambios';
			} catch (error) {
				gitStatus = `No disponible: ${this.errorMessage(error)}`;
			}
		}
		if (!profile) {
			return { root: this.root, manifest, recentEvents: [], gitStatus };
		}
		const stateService = new ActivityStateService(this.root, profile);
		if (!await stateService.exists()) {
			return { root: this.root, manifest, profile, recentEvents: [], gitStatus };
		}
		const eventLog = new EventLogService(stateService);
		return {
			root: this.root,
			manifest,
			profile,
			state: await stateService.load(),
			recentEvents: await eventLog.getRecent(15),
			gitStatus
		};
	}

	public async appendEvent(
		event: string,
		data: Record<string, unknown> = {},
		taskId?: string | null
	): Promise<void> {
		if (this.exportInProgress) {
			return;
		}
		const context = await this.getStudentContext(false);
		if (!context) {
			return;
		}
		await context.eventLog.append({ event, data, taskId });
		this.notifyChanged();
	}

	public async prepareSubmissionExport(fileName: string): Promise<string | undefined> {
		const context = await this.requireStudentContext();
		this.exportInProgress = true;
		try {
			await new AgentInstructionsService(context.root, context.profile)
				.ensureRootInstructions();
			const state = await context.stateService.load();
			await context.eventLog.append({
				event: 'submission_exported',
				data: { file: fileName }
			});
			if (!state.git.enabled) {
				this.notifyChanged();
				return undefined;
			}
			const commitHash = await new GitService(context.root).createCheckpoint(
				'Submission export',
				context.profile.studentId
			);
			this.notifyChanged();
			return commitHash;
		} catch (error) {
			this.exportInProgress = false;
			throw error;
		}
	}

	public finishSubmissionExport(): void {
		this.exportInProgress = false;
	}

	public async startTask(taskId: string): Promise<void> {
		const context = await this.requireStudentContext();
		const state = await context.stateService.load();
		if (!(taskId in state.tasks)) {
			throw new Error(`La tarea "${taskId}" no existe.`);
		}
		if (state.currentTaskId) {
			throw new Error(`Ya está activa la tarea "${state.currentTaskId}".`);
		}
		if (state.tasks[taskId].status === 'completed') {
			throw new Error(`La tarea "${taskId}" ya está terminada.`);
		}
		let startCommit: string | undefined;
		if (state.git.enabled) {
			startCommit = await new GitService(context.root).createTaskStartMarker(
				taskId,
				context.profile.studentId
			);
		}
		const startedAt = new Date().toISOString();
		await context.stateService.update(current => {
			current.currentTaskId = taskId;
			current.tasks[taskId] = { status: 'active', startedAt, startCommit };
		});
		await context.eventLog.append({ event: 'task_started', taskId });
		await this.regenerateAgentFiles(context);
		this.notifyChanged();
	}

	public async finishTask(taskId: string): Promise<TaskMetadata> {
		const context = await this.requireStudentContext();
		const state = await context.stateService.load();
		const task = state.tasks[taskId];
		if (!task || state.currentTaskId !== taskId || task.status !== 'active' || !task.startedAt) {
			throw new Error(`La tarea "${taskId}" no está activa.`);
		}
		const gitService = new GitService(context.root);
		const finishedAt = new Date().toISOString();
		const modifiedFiles = state.git.enabled
			? (await gitService.getChangedFiles(task.startCommit))
				.filter(file => !file.startsWith('.vsc4education/'))
			: [];
		const metadata: TaskMetadata = {
			taskId,
			startedAt: task.startedAt,
			finishedAt,
			durationMinutes: Math.max(
				0,
				Math.round((Date.parse(finishedAt) - Date.parse(task.startedAt)) / 60000)
			),
			modifiedFiles,
			fileSavedEvents: await context.eventLog.count('file_saved', taskId),
			startCommit: task.startCommit
		};
		await writeJson(contributionPath(
			context.root,
			context.profile.contributionId,
			'task-metadata',
			`${taskId}.json`
		), metadata);
		await context.stateService.update(current => {
			current.currentTaskId = null;
			current.tasks[taskId] = {
				...current.tasks[taskId],
				status: 'completed',
				finishedAt
			};
		});
		await context.eventLog.append({
			event: 'task_finished',
			taskId,
			data: {
				durationMinutes: metadata.durationMinutes,
				modifiedFiles,
				fileSavedEvents: metadata.fileSavedEvents
			}
		});
		await this.regenerateAgentFiles(context);
		if (state.git.enabled) {
			metadata.finishCommit = await gitService.commitTaskCompletion(
				taskId,
				context.profile.studentId
			);
		}
		this.notifyChanged();
		return metadata;
	}

	private async regenerateAgentFiles(context: StudentContext): Promise<void> {
		const manifest = await readJson<ActivityManifest>(manifestPath(context.root));
		await new AgentInstructionsService(context.root, context.profile).generate(
			manifest,
			await context.stateService.load(),
			await context.eventLog.getRecent()
		);
	}

	private async requireStudentContext(): Promise<StudentContext> {
		const context = await this.getStudentContext(true);
		if (!context) {
			throw new Error('Debes registrar al estudiante antes de continuar.');
		}
		return context;
	}

	private async getStudentContext(required: boolean): Promise<StudentContext | undefined> {
		const root = this.requireRoot();
		const profile = await this.profiles.getActive(root);
		if (!profile) {
			if (required) {
				throw new Error('Debes registrar al estudiante antes de continuar.');
			}
			return undefined;
		}
		const stateService = new ActivityStateService(root, profile);
		if (!await stateService.exists()) {
			if (required) {
				throw new Error('La contribución activa no tiene estado inicializado.');
			}
			return undefined;
		}
		return {
			root,
			profile,
			stateService,
			eventLog: new EventLogService(stateService)
		};
	}

	private requireRoot(): string {
		if (!this.root) {
			throw new Error('No hay una actividad cargada.');
		}
		return this.root;
	}

	private notifyChanged(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}

	private errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
}
