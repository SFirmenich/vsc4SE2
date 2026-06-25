import * as path from 'path';
import * as vscode from 'vscode';

import { isIgnoredPath, relativeWorkspacePath } from '../utils/paths';
import { LearningActivityService } from './LearningActivityService';

export class TrackingService implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];

	public constructor(private readonly activityService: LearningActivityService) {
		this.disposables.push(
			vscode.window.onDidChangeActiveTextEditor(editor => {
				if (editor) {
					void this.trackFile('active_editor_changed', editor.document.uri);
				}
			}),
			vscode.workspace.onDidChangeTextDocument(event => {
				if (!vscode.workspace.getConfiguration('learningActivity')
					.get<boolean>('trackTextChanges', true)) {
					return;
				}
				const lines = event.contentChanges.map(change => ({
					start: change.range.start.line + 1,
					end: change.range.end.line + 1
				}));
				void this.trackFile('file_changed', event.document.uri, {
					changeCount: event.contentChanges.length,
					lines
				});
			}),
			vscode.workspace.onDidSaveTextDocument(document => {
				void this.trackFile('file_saved', document.uri);
			}),
			vscode.workspace.onDidCreateFiles(event => {
				for (const uri of event.files) {
					void this.trackFile('file_created', uri);
				}
			}),
			vscode.workspace.onDidDeleteFiles(event => {
				for (const uri of event.files) {
					void this.trackFile('file_deleted', uri);
				}
			}),
			vscode.window.onDidOpenTerminal(terminal => {
				if (vscode.workspace.getConfiguration('learningActivity')
					.get<boolean>('trackTerminalOpen', true)) {
					void this.activityService.appendEvent('terminal_opened', {
						name: terminal.name
					}).catch(() => undefined);
				}
			})
		);
	}

	public dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	private async trackFile(
		event: string,
		uri: vscode.Uri,
		data: Record<string, unknown> = {}
	): Promise<void> {
		if (uri.scheme !== 'file') {
			return;
		}
		const root = this.activityService.getRoot();
		if (!root) {
			return;
		}
		const relativePath = relativeWorkspacePath(root, uri.fsPath);
		if (
			relativePath === '..'
			|| relativePath.startsWith('../')
			|| path.isAbsolute(relativePath)
			|| isIgnoredPath(relativePath)
		) {
			return;
		}
		const foreignContribution = await this.getForeignContribution(relativePath);
		if (foreignContribution) {
			await this.activityService.appendEvent('foreign_contribution_modified', {
				event,
				file: relativePath,
				foreignContribution
			});
			return;
		}
		await this.activityService.appendEvent(event, {
			file: relativePath,
			...data
		});
	}

	private async getForeignContribution(relativePath: string): Promise<string | undefined> {
		const match = /^\.vsc4education\/contributions\/([^/]+)\//.exec(relativePath);
		if (!match) {
			return undefined;
		}
		const profile = await this.activityService.getActiveProfile();
		return profile && match[1] !== profile.contributionId ? match[1] : undefined;
	}
}
