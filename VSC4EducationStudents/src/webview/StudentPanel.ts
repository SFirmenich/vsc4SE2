import { randomBytes } from 'crypto';
import * as vscode from 'vscode';

import { LearningActivityService } from '../services/LearningActivityService';
import { getStudentPanelHtml } from './html';

export class StudentPanel {
	private static current: StudentPanel | undefined;
	private readonly changeSubscription: { dispose(): void };

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		private readonly activityService: LearningActivityService
	) {
		this.changeSubscription = activityService.onDidChange(() => {
			void this.refresh();
		});
		this.panel.onDidDispose(() => this.dispose());
		this.panel.webview.onDidReceiveMessage(message => {
			void this.handleMessage(message);
		});
		void this.initialize();
	}

	public static show(activityService: LearningActivityService): void {
		if (StudentPanel.current) {
			StudentPanel.current.panel.reveal(vscode.ViewColumn.One);
			void StudentPanel.current.refresh();
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			'learningActivity.studentPanel',
			'Learning Activity Tracker',
			vscode.ViewColumn.One,
			{ enableScripts: true, retainContextWhenHidden: true }
		);
		StudentPanel.current = new StudentPanel(panel, activityService);
	}

	private async initialize(): Promise<void> {
		this.panel.webview.html = getStudentPanelHtml(
			await this.activityService.getSnapshot(),
			randomBytes(16).toString('base64')
		);
	}

	private async refresh(): Promise<void> {
		await this.panel.webview.postMessage({
			command: 'refresh',
			snapshot: await this.activityService.getSnapshot()
		});
	}

	private async handleMessage(message: { command?: string; taskId?: string }): Promise<void> {
		switch (message.command) {
			case 'loadZip':
				await vscode.commands.executeCommand('learningActivity.loadFromZip');
				break;
			case 'loadUrl':
				await vscode.commands.executeCommand('learningActivity.loadFromUrl');
				break;
			case 'registerStudent':
				await vscode.commands.executeCommand('learningActivity.registerStudent');
				break;
			case 'startTask':
				await vscode.commands.executeCommand('learningActivity.startTask', message.taskId);
				break;
			case 'finishTask':
				await vscode.commands.executeCommand('learningActivity.finishTask', message.taskId);
				break;
			case 'exportSubmission':
				await vscode.commands.executeCommand('learningActivity.exportSubmission');
				break;
		}
		await this.refresh();
	}

	private dispose(): void {
		this.changeSubscription.dispose();
		StudentPanel.current = undefined;
	}
}
