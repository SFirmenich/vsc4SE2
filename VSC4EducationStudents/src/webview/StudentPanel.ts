import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';

import { LearningActivityService } from '../services/LearningActivityService';
import { LEARNING_DIRECTORY } from '../utils/paths';
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
			case 'openTaskFile':
				await this.openTaskFile(message.taskId);
				break;
			case 'exportSubmission':
				await vscode.commands.executeCommand('learningActivity.exportSubmission');
				break;
		}
		await this.refresh();
	}

	private async openTaskFile(taskId: string | undefined): Promise<void> {
		if (!taskId) {
			throw new Error('No se indicó la tarea.');
		}
		const snapshot = await this.activityService.getSnapshot();
		if (!snapshot) {
			throw new Error('No hay una actividad cargada.');
		}
		const task = snapshot.manifest.tasks.find(item => item.id === taskId);
		if (!task) {
			throw new Error(`La tarea "${taskId}" no existe.`);
		}
		if (!task.file) {
			throw new Error(`La tarea "${taskId}" no tiene un enunciado Markdown asociado.`);
		}
		if (path.isAbsolute(task.file)) {
			throw new Error(`El enunciado de la tarea "${taskId}" no usa una ruta relativa válida.`);
		}
		const activityRoot = path.resolve(snapshot.root, LEARNING_DIRECTORY);
		const target = path.resolve(activityRoot, task.file);
		const relative = path.relative(activityRoot, target);
		if (relative.startsWith('..') || path.isAbsolute(relative)) {
			throw new Error(`El enunciado de la tarea "${taskId}" apunta fuera de la actividad.`);
		}
		const uri = vscode.Uri.file(target);
		try {
			await vscode.workspace.fs.stat(uri);
		} catch {
			throw new Error(`No se encontró el enunciado de la tarea "${taskId}".`);
		}
		await vscode.commands.executeCommand('markdown.showPreview', uri);
	}

	private dispose(): void {
		this.changeSubscription.dispose();
		StudentPanel.current = undefined;
	}
}
