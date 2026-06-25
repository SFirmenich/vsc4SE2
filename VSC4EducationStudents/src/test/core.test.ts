import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { ActivityLoader } from '../services/ActivityLoader';
import { ActivityStateService } from '../services/ActivityStateService';
import { AgentInstructionsService } from '../services/AgentInstructionsService';
import { EventLogService } from '../services/EventLogService';
import { GitService } from '../services/GitService';
import { LearningActivityService } from '../services/LearningActivityService';
import { StudentProfileService } from '../services/StudentProfileService';
import { ZipService } from '../services/ZipService';
import { ActivityManifest } from '../types/ActivityManifest';
import { StudentProfile } from '../types/StudentProfile';
import { createEventHash } from '../utils/crypto';
import { readJson, writeJson } from '../utils/fs';
import { canonicalJson } from '../utils/json';
import {
	activityConfigurationPath,
	contributionPath,
	learningPath,
	manifestPath
} from '../utils/paths';

const manifest: ActivityManifest = {
	id: 'test-activity',
	title: 'Test Activity',
	tasks: [{ id: 'task-1', title: 'Task 1' }]
};

class MemoryMemento implements vscode.Memento {
	private readonly values = new Map<string, unknown>();

	public keys(): readonly string[] {
		return [...this.values.keys()];
	}

	public get<T>(key: string): T | undefined;
	public get<T>(key: string, defaultValue: T): T;
	public get<T>(key: string, defaultValue?: T): T | undefined {
		return (this.values.has(key) ? this.values.get(key) : defaultValue) as T | undefined;
	}

	public update(key: string, value: unknown): Thenable<void> {
		if (value === undefined) {
			this.values.delete(key);
		} else {
			this.values.set(key, value);
		}
		return Promise.resolve();
	}
}

suite('Learning Activity core', () => {
	let root: string;
	let profiles: StudentProfileService;
	let ana: StudentProfile;

	setup(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'learning-test-'));
		profiles = new StudentProfileService(new MemoryMemento());
		ana = await profiles.register(root, {
			studentId: 'ana-001',
			firstName: 'Ana',
			lastName: 'García'
		});
	});

	teardown(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	test('canonicalJson produces stable output', () => {
		const first = canonicalJson({ z: 1, nested: { b: 2, a: 1 }, a: 3 });
		const second = canonicalJson({ a: 3, nested: { a: 1, b: 2 }, z: 1 });
		assert.strictEqual(first, second);
	});

	test('hash chain changes with previous hash', () => {
		const firstHash = createEventHash(null, { event: 'heartbeat' });
		const secondHash = createEventHash(firstHash, { event: 'heartbeat' });
		assert.notStrictEqual(firstHash, secondHash);
		assert.strictEqual(firstHash.length, 64);
	});

	test('EventLogService creates an independent student hash chain', async () => {
		const stateService = new ActivityStateService(root, ana);
		await stateService.create(manifest, false);
		const eventLog = new EventLogService(stateService);
		const first = await eventLog.append({ event: 'student_registered' });
		const second = await eventLog.append({ event: 'heartbeat' });

		assert.strictEqual(first.studentId, 'ana-001');
		assert.strictEqual(first.previousHash, null);
		assert.strictEqual(second.previousHash, first.hash);
		assert.strictEqual((await stateService.load()).lastEventHash, second.hash);
	});

	test('ActivityStateService stores state in the contribution directory', async () => {
		const service = new ActivityStateService(root, ana);
		await service.create(manifest, true);
		await service.update(state => {
			state.currentTaskId = 'task-1';
			state.tasks['task-1'].status = 'active';
		});
		const state = await readJson<{ studentId: string; currentTaskId: string }>(
			contributionPath(root, ana.contributionId, 'state.json')
		);
		assert.strictEqual(state.studentId, ana.studentId);
		assert.strictEqual(state.currentTaskId, 'task-1');
	});

	test('a local workspace cannot switch to another student identity', async () => {
		await assert.rejects(
			profiles.register(root, {
				studentId: 'juan-002',
				firstName: 'Juan',
				lastName: 'Pérez'
			}),
			/ya está vinculado/
		);
		assert.strictEqual((await profiles.getActive(root))?.studentId, 'ana-001');
	});

	test('AgentInstructionsService targets the active contribution', async () => {
		await fs.mkdir(learningPath(root, 'agent'), { recursive: true });
		await fs.writeFile(
			learningPath(root, 'agent', 'instructions.md'),
			'Regla del profesor.',
			'utf8'
		);
		const stateService = new ActivityStateService(root, ana);
		const state = await stateService.create(manifest, false);
		await new AgentInstructionsService(root, ana).generate(manifest, state, []);
		const agents = await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8');

		assert.match(agents, /contributions\/ana-001\/agent-interactions\.jsonl/);
		assert.ok(await fs.stat(contributionPath(
			root,
			ana.contributionId,
			'AGENTS.generated.md'
		)));
		assert.ok(await fs.stat(contributionPath(
			root,
			ana.contributionId,
			'agent-interactions.jsonl'
		)));
	});

	test('GitService handles missing Git executable', async () => {
		assert.strictEqual(
			await new GitService(root, 'git-command-that-does-not-exist').isGitInstalled(),
			false
		);
	});

	test('GitService attributes commits to a student', async function () {
		this.timeout(20000);
		const git = new GitService(root);
		if (!await git.isGitInstalled()) {
			this.skip();
		}
		await fs.writeFile(path.join(root, 'README.md'), '# Test\n', 'utf8');
		await git.initRepository();
		await git.configureStudentIdentity(ana.displayName, ana.studentId);
		await git.createInitialCommit();
		await git.createTaskStartMarker('task-1', ana.studentId);
		const subject = await new Promise<string>((resolve, reject) => {
			const { execFile } = require('child_process') as typeof import('child_process');
			execFile('git', ['log', '-1', '--pretty=%s'], { cwd: root }, (error, stdout) => {
				error ? reject(error) : resolve(stdout.trim());
			});
		});
		assert.strictEqual(subject, '[ana-001] Task started: task-1');
	});

	test('ActivityLoader keeps common material outside contributions', async () => {
		const zipPath = path.resolve('examples', 'poo-basico-01.zip');
		await new ActivityLoader(new ZipService()).load(zipPath, root, false);

		assert.ok(await fs.stat(manifestPath(root)));
		assert.ok(await fs.stat(learningPath(root, 'theory', 'teoria.md')));
		assert.ok(await fs.stat(path.join(root, 'src', 'Animal.ts')));
		await assert.rejects(fs.stat(learningPath(root, 'state.json')));
	});

	test('loading into a directory without Git initializes the repository', async function () {
		this.timeout(20000);
		const git = new GitService(root);
		if (!await git.isGitInstalled()) {
			this.skip();
		}
		await new ActivityLoader(new ZipService()).load(
			path.resolve('examples', 'poo-basico-01.zip'),
			root,
			true
		);
		const configuration = await readJson<{
			repositoryMode: string;
			gitEnabled: boolean;
		}>(activityConfigurationPath(root));

		assert.strictEqual(await git.isRepository(), true);
		assert.strictEqual(configuration.gitEnabled, true);
		assert.strictEqual(configuration.repositoryMode, 'created');
		assert.strictEqual(await gitSubject(root), 'Initial activity state');
	});

	test('loading into an existing repository preserves history and adds a checkpoint', async function () {
		this.timeout(20000);
		const git = new GitService(root);
		if (!await git.isGitInstalled()) {
			this.skip();
		}
		await fs.writeFile(path.join(root, 'existing.txt'), 'existing\n', 'utf8');
		await git.initRepository();
		const originalCommit = await git.createInitialCommit();
		await new ActivityLoader(new ZipService()).load(
			path.resolve('examples', 'poo-basico-01.zip'),
			root,
			true
		);
		const configuration = await readJson<{ repositoryMode: string }>(
			activityConfigurationPath(root)
		);

		assert.strictEqual(configuration.repositoryMode, 'existing');
		assert.strictEqual(await gitSubject(root), 'Checkpoint: Activity loaded');
		assert.notStrictEqual(await git.getCurrentCommitHash(), originalCommit);
		assert.strictEqual(await git.getStatus(), '');
	});

	test('opening an existing activity repository resumes without another Git commit', async function () {
		this.timeout(20000);
		const git = new GitService(root);
		if (!await git.isGitInstalled()) {
			this.skip();
		}
		await new ActivityLoader(new ZipService()).load(
			path.resolve('examples', 'poo-basico-01.zip'),
			root,
			true
		);
		const localState = new MemoryMemento();
		const firstService = new LearningActivityService(
			new StudentProfileService(localState)
		);
		firstService.setRoot(root);
		await firstService.registerStudent({
			studentId: 'ana-open',
			firstName: 'Ana',
			lastName: 'Open'
		});
		await git.createCheckpoint('Persist contribution', 'ana-open');
		const commitBeforeOpen = await git.getCurrentCommitHash();

		const reopenedService = new LearningActivityService(
			new StudentProfileService(localState)
		);
		assert.strictEqual(await reopenedService.useRootIfActivity(root), true);
		const commitAfterOpen = await git.getCurrentCommitHash();
		const snapshot = await reopenedService.getSnapshot();

		assert.strictEqual(commitAfterOpen, commitBeforeOpen);
		assert.strictEqual(snapshot?.profile?.studentId, 'ana-open');
		assert.strictEqual(snapshot?.recentEvents.at(-1)?.event, 'student_session_started');
	});

	test('two students keep isolated states, events and metadata', async () => {
		await writeJson(manifestPath(root), manifest);
		await writeJson(activityConfigurationPath(root), {
			loadedAt: new Date().toISOString(),
			gitEnabled: false
		});
		await fs.mkdir(learningPath(root, 'agent'), { recursive: true });
		await fs.writeFile(
			learningPath(root, 'agent', 'instructions.md'),
			'No resolver tareas.',
			'utf8'
		);
		const service = new LearningActivityService(profiles);
		service.setRoot(root);
		await service.registerStudent({
			studentId: 'ana-001',
			firstName: 'Ana',
			lastName: 'García'
		});
		await service.startTask('task-1');
		await service.appendEvent('file_saved', { file: 'src/a.ts' });
		await service.finishTask('task-1');

		const juanProfiles = new StudentProfileService(new MemoryMemento());
		const juanService = new LearningActivityService(juanProfiles);
		juanService.setRoot(root);
		const juan = await juanService.registerStudent({
			studentId: 'juan-002',
			firstName: 'Juan',
			lastName: 'Pérez'
		});
		const juanSnapshot = await juanService.getSnapshot();
		const anaState = await new ActivityStateService(root, ana).load();
		const juanState = await new ActivityStateService(root, juan).load();

		assert.strictEqual(anaState.tasks['task-1'].status, 'completed');
		assert.strictEqual(juanState.tasks['task-1'].status, 'pending');
		assert.strictEqual(juanSnapshot?.profile?.studentId, 'juan-002');
		assert.ok(await fs.stat(contributionPath(root, ana.contributionId, 'profile.json')));
		assert.ok(await fs.stat(contributionPath(root, juan.contributionId, 'profile.json')));
		assert.ok(await fs.stat(contributionPath(root, ana.contributionId, 'events.jsonl')));
		assert.ok(await fs.stat(contributionPath(root, juan.contributionId, 'events.jsonl')));
		assert.ok(await fs.stat(contributionPath(
			root,
			ana.contributionId,
			'agent-interactions.jsonl'
		)));
		assert.ok(await fs.stat(contributionPath(
			root,
			juan.contributionId,
			'agent-interactions.jsonl'
		)));
		assert.ok(await fs.stat(contributionPath(
			root,
			ana.contributionId,
			'task-metadata',
			'task-1.json'
		)));
		await assert.rejects(fs.stat(contributionPath(
			root,
			juan.contributionId,
			'task-metadata',
			'task-1.json'
		)));
	});

	test('submission checkpoint is attributed to the active student', async function () {
		this.timeout(20000);
		const git = new GitService(root);
		if (!await git.isGitInstalled()) {
			this.skip();
		}
		await writeJson(manifestPath(root), manifest);
		await writeJson(activityConfigurationPath(root), {
			loadedAt: new Date().toISOString(),
			gitEnabled: true
		});
		await fs.mkdir(learningPath(root, 'agent'), { recursive: true });
		await fs.writeFile(
			learningPath(root, 'agent', 'instructions.md'),
			'No resolver tareas.',
			'utf8'
		);
		await git.initRepository();
		await git.createInitialCommit();
		const service = new LearningActivityService(profiles);
		service.setRoot(root);
		await service.registerStudent({
			studentId: 'ana-001',
			firstName: 'Ana',
			lastName: 'García'
		});
		await fs.writeFile(path.join(root, 'solution.ts'), 'export const value = 1;\n', 'utf8');
		await service.prepareSubmissionExport('submission.zip');
		service.finishSubmissionExport();
		const subject = await new Promise<string>((resolve, reject) => {
			const { execFile } = require('child_process') as typeof import('child_process');
			execFile('git', ['log', '-1', '--pretty=%s'], { cwd: root }, (error, stdout) => {
				error ? reject(error) : resolve(stdout.trim());
			});
		});
		assert.strictEqual(subject, '[ana-001] Checkpoint: Submission export');
		assert.strictEqual(await git.getStatus(), '');
	});
});

async function gitSubject(root: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const { execFile } = require('child_process') as typeof import('child_process');
		execFile('git', ['log', '-1', '--pretty=%s'], { cwd: root }, (error, stdout) => {
			error ? reject(error) : resolve(stdout.trim());
		});
	});
}
