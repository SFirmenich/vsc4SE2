import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitRepositoryPreparation {
	mode: 'created' | 'existing';
	baseCommit: string;
}

export class GitService {
	public constructor(
		private readonly root: string,
		private readonly executable = 'git'
	) {}

	public async isGitInstalled(): Promise<boolean> {
		try {
			await this.run(['--version'], undefined);
			return true;
		} catch {
			return false;
		}
	}

	public async initRepository(): Promise<void> {
		await this.run(['init']);
		await this.ensureIdentity();
	}

	public async isRepository(): Promise<boolean> {
		try {
			return (await this.run(['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
		} catch {
			return false;
		}
	}

	public async hasCommits(): Promise<boolean> {
		try {
			await this.run(['rev-parse', '--verify', 'HEAD']);
			return true;
		} catch {
			return false;
		}
	}

	public async prepareActivityRepository(): Promise<GitRepositoryPreparation> {
		const existed = await this.isRepository();
		if (!existed) {
			await this.initRepository();
		} else {
			await this.ensureIdentity();
		}
		const hasCommits = await this.hasCommits();
		const baseCommit = hasCommits
			? await this.createCheckpoint('Activity loaded')
			: await this.createInitialCommit();
		return {
			mode: existed ? 'existing' : 'created',
			baseCommit
		};
	}

	public async createInitialCommit(): Promise<string> {
		await this.run(['add', '.']);
		await this.commit('Initial activity state');
		return this.getCurrentCommitHash();
	}

	public async createTaskStartMarker(taskId: string, studentId?: string): Promise<string> {
		await this.commit(`${this.prefix(studentId)}Task started: ${taskId}`, true);
		return this.getCurrentCommitHash();
	}

	public async commitTaskCompletion(taskId: string, studentId?: string): Promise<string> {
		await this.run(['add', '.']);
		await this.commit(`${this.prefix(studentId)}Task completed: ${taskId}`, true);
		return this.getCurrentCommitHash();
	}

	public async getStatus(): Promise<string> {
		return (await this.run(['status', '--short'])).trim();
	}

	public async getChangedFiles(sinceCommit?: string): Promise<string[]> {
		const files = new Set<string>();
		if (sinceCommit) {
			const diff = await this.run(['diff', '--name-only', sinceCommit]);
			for (const file of diff.split(/\r?\n/).filter(Boolean)) {
				files.add(file);
			}
		}

		const status = await this.getStatus();
		for (const line of status.split(/\r?\n/).filter(Boolean)) {
			files.add(line.slice(3).trim());
		}
		return [...files].sort();
	}

	public async getCurrentCommitHash(): Promise<string> {
		return (await this.run(['rev-parse', 'HEAD'])).trim();
	}

	public async createCheckpoint(reason: string, studentId?: string): Promise<string> {
		await this.run(['add', '.']);
		await this.commit(`${this.prefix(studentId)}Checkpoint: ${reason}`, true);
		return this.getCurrentCommitHash();
	}

	public async configureStudentIdentity(
		displayName: string,
		studentId: string
	): Promise<void> {
		await this.run(['config', 'user.name', displayName]);
		await this.run(['config', 'user.email', `${studentId}@students.local`]);
		await this.run(['config', 'commit.gpgsign', 'false']);
	}

	private async ensureIdentity(): Promise<void> {
		await this.run(['config', 'commit.gpgsign', 'false']);
		const name = await this.tryRun(['config', '--get', 'user.name']);
		const email = await this.tryRun(['config', '--get', 'user.email']);
		if (!name.trim()) {
			await this.run(['config', 'user.name', 'Learning Activity Student']);
		}
		if (!email.trim()) {
			await this.run(['config', 'user.email', 'student@example.local']);
		}
	}

	private async commit(message: string, allowEmpty = false): Promise<void> {
		const args = ['commit'];
		if (allowEmpty) {
			args.push('--allow-empty');
		}
		args.push('-m', message);
		await this.run(args);
	}

	private prefix(studentId?: string): string {
		return studentId ? `[${studentId}] ` : '';
	}

	private async tryRun(args: string[]): Promise<string> {
		try {
			return await this.run(args);
		} catch {
			return '';
		}
	}

	private async run(args: string[], cwd = this.root): Promise<string> {
		const result = await execFileAsync(this.executable, args, {
			cwd,
			windowsHide: true,
			maxBuffer: 10 * 1024 * 1024
		});
		return result.stdout;
	}
}
