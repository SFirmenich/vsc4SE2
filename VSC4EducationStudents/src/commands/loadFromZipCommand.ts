import * as fs from 'fs/promises';
import * as vscode from 'vscode';

import { t } from '../i18n';
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
			filters: { [t('Activity ZIP')]: ['zip'] },
			title: t('Select an activity')
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
		openLabel: t('Use as working project'),
		title: t('Select the destination folder')
	});
	if (!destination?.[0]) {
		return;
	}
	const destinationEntries = await fs.readdir(destination[0].fsPath);
	const continueLabel = t('Continue');
	if (destinationEntries.length > 0) {
		const confirmation = await vscode.window.showWarningMessage(
			t('The destination folder is not empty. The activity may overwrite files with the same name.'),
			{ modal: true },
			continueLabel
		);
		if (confirmation !== continueLabel) {
			return;
		}
	}
	const configuration = vscode.workspace.getConfiguration('learningActivity');
	const loaded = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: t('Loading activity...'),
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
			t('Git is not available. The activity will continue without Git integration.')
		);
	} else if (loaded.repositoryMode === 'created') {
		await vscode.window.showInformationMessage(
			t('A new Git repository was initialized for the activity.')
		);
	} else if (loaded.repositoryMode === 'existing') {
		await vscode.window.showInformationMessage(
			t('The existing Git repository was reused and its history was preserved.')
		);
	}
	await vscode.window.showInformationMessage(t('Activity loaded: {0}', loaded.manifest.title));
	await vscode.commands.executeCommand('learningActivity.registerStudent');
	if (configuration.get<boolean>('autoOpenPanelAfterLoad', true)) {
		StudentPanel.show(activityService);
	}
}
