import * as path from 'path';
import * as vscode from 'vscode';

import { AgentInstructionsService } from './AgentInstructionsService';
import { LearningActivityService } from './LearningActivityService';

export class AgentInstructionsGuardService implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private watchers: vscode.FileSystemWatcher[] = [];
	private ensureQueue: Promise<void> = Promise.resolve();
	private guardedRoot: string | undefined;

	public constructor(private readonly activityService: LearningActivityService) {
		this.disposables.push(
			activityService.onDidChange(() => {
				this.refreshRoot();
				this.scheduleEnsure();
			}),
			vscode.workspace.onDidSaveTextDocument(document => {
				if (this.isAgentsFile(document.uri)) {
					this.scheduleEnsure();
				}
			})
		);
		this.refreshRoot();
	}

	public dispose(): void {
		this.disposeWatchers();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	public ensureNow(): Promise<void> {
		this.scheduleEnsure();
		return this.ensureQueue;
	}

	private refreshRoot(): void {
		const root = this.activityService.getRoot();
		if (root === this.guardedRoot) {
			return;
		}
		this.guardedRoot = root;
		this.disposeWatchers();
		if (!root) {
			return;
		}
		this.watchers = [
			this.createWatcher(root, 'AGENTS.md'),
			this.createWatcher(root, '.vsc4education/agent/instructions.md')
		];
		this.scheduleEnsure();
	}

	private createWatcher(root: string, pattern: string): vscode.FileSystemWatcher {
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(root, pattern)
		);
		watcher.onDidChange(() => this.scheduleEnsure());
		watcher.onDidCreate(() => this.scheduleEnsure());
		watcher.onDidDelete(() => this.scheduleEnsure());
		return watcher;
	}

	private disposeWatchers(): void {
		for (const watcher of this.watchers) {
			watcher.dispose();
		}
		this.watchers = [];
	}

	private scheduleEnsure(): void {
		this.ensureQueue = this.ensureQueue
			.catch(() => undefined)
			.then(async () => {
				const root = this.activityService.getRoot();
				if (!root) {
					return;
				}
				const profile = await this.activityService.getActiveProfile();
				if (!profile) {
					return;
				}
				const restored = await new AgentInstructionsService(root, profile)
					.ensureRootInstructions();
				if (restored) {
					await this.activityService.appendEvent('agents_file_restored', {
						file: 'AGENTS.md'
					});
				}
			})
			.catch(error => {
				console.error('Unable to restore AGENTS.md', error);
			});
	}

	private isAgentsFile(uri: vscode.Uri): boolean {
		const root = this.activityService.getRoot();
		const resolved = path.resolve(uri.fsPath);
		return uri.scheme === 'file'
			&& root !== undefined
			&& (
				resolved === path.resolve(root, 'AGENTS.md')
				|| resolved === path.resolve(
					root,
					'.vsc4education',
					'agent',
					'instructions.md'
				)
			);
	}
}
