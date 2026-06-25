import * as fs from 'fs/promises';
import * as vscode from 'vscode';

import { ActivityLoader } from '../services/ActivityLoader';
import { LearningActivityService } from '../services/LearningActivityService';
import { StudentPanel } from '../webview/StudentPanel';
import { runCommand } from './commandUtils';

export const LOAD_FROM_ZIP_COMMAND = 'learningActivity.loadFromZip';

export function registerLoadFromZipCommand(
	loader: ActivityLoader,
	activityService: LearningActivityService
): vscode.Disposable {
	return vscode.commands.registerCommand(LOAD_FROM_ZIP_COMMAND, () => runCommand(async () => {
		const selected = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			filters: { 'Actividad ZIP': ['zip'] },
			title: 'Selecciona una actividad'
		});
		if (!selected?.[0]) {
			return;
		}
		await loadSelectedZip(selected[0].fsPath, loader, activityService);
	}));
}

export async function loadSelectedZip(
	zipPath: string,
	loader: ActivityLoader,
	activityService: LearningActivityService
): Promise<void> {
	const destination = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: 'Usar como proyecto de trabajo',
		title: 'Selecciona la carpeta de destino'
	});
	if (!destination?.[0]) {
		return;
	}
	const destinationEntries = await fs.readdir(destination[0].fsPath);
	if (destinationEntries.length > 0) {
		const confirmation = await vscode.window.showWarningMessage(
			'La carpeta de destino no está vacía. La actividad puede sobrescribir archivos con el mismo nombre.',
			{ modal: true },
			'Continuar'
		);
		if (confirmation !== 'Continuar') {
			return;
		}
	}
	const configuration = vscode.workspace.getConfiguration('learningActivity');
	const loaded = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Cargando actividad...',
			cancellable: false
		},
		() => loader.load(
			zipPath,
			destination[0].fsPath,
			configuration.get<boolean>('enableGitIntegration', true)
		)
	);
	activityService.setRoot(loaded.root);
	const alreadyInWorkspace = vscode.workspace.workspaceFolders?.some(
		folder => folder.uri.fsPath === loaded.root
	);
	if (!alreadyInWorkspace) {
		vscode.workspace.updateWorkspaceFolders(
			vscode.workspace.workspaceFolders?.length ?? 0,
			0,
			{ uri: vscode.Uri.file(loaded.root), name: loaded.manifest.title }
		);
	}
	if (!loaded.gitAvailable && configuration.get<boolean>('enableGitIntegration', true)) {
		await vscode.window.showWarningMessage(
			'Git no está disponible. La actividad continuará sin integración Git.'
		);
	} else if (loaded.repositoryMode === 'created') {
		await vscode.window.showInformationMessage(
			'Se inicializó un nuevo repositorio Git para la actividad.'
		);
	} else if (loaded.repositoryMode === 'existing') {
		await vscode.window.showInformationMessage(
			'Se reutilizó el repositorio Git existente y se conservó su historial.'
		);
	}
	await vscode.window.showInformationMessage(`Actividad cargada: ${loaded.manifest.title}`);
	await vscode.commands.executeCommand('learningActivity.registerStudent');
	if (configuration.get<boolean>('autoOpenPanelAfterLoad', true)) {
		StudentPanel.show(activityService);
	}
}
