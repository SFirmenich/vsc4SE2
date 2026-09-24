import * as path from 'path';
import * as vscode from 'vscode';

import { t } from '../i18n';
import { LearningActivityService } from '../services/LearningActivityService';
import { isIgnoredPath, relativeWorkspacePath } from '../utils/paths';
import { runCommand } from './commandUtils';

export const CLOSE_SESSION_COMMAND = 'learningActivity.closeSession';

export function registerCloseSessionCommand(
	activityService: LearningActivityService
): vscode.Disposable {
	return vscode.commands.registerCommand(
		CLOSE_SESSION_COMMAND,
		() => runCommand(async () => {
			const snapshot = await activityService.getSnapshot();
			if (!snapshot?.profile || !snapshot.state) {
				await vscode.window.showInformationMessage(t('There is no active session to close.'));
				return;
			}

			const dirtyDocuments = findDirtyActivityDocuments(snapshot.root);
			if (dirtyDocuments.length > 0) {
				const saveAll = t('Save all and continue');
				const cancel = t('Cancel');
				const relativePaths = dirtyDocuments.map(
					document => relativeWorkspacePath(snapshot.root, document.uri.fsPath)
				);
				const choice = await vscode.window.showWarningMessage(
					t('You have unsaved files in this activity. Save them before closing the session?'),
					{ modal: true, detail: relativePaths.join('\n') },
					saveAll,
					cancel
				);
				if (choice !== saveAll) {
					return;
				}
				for (const document of dirtyDocuments) {
					await document.save();
				}
			}

			// Awaiting this append is what guarantees every event queued before it
			// (heartbeats, file-tracking events, etc.) has already been written to
			// disk: they all share the same per-contribution write queue in
			// ActivityStateService, so this call only resolves once the whole
			// chain up to this point has settled.
			await activityService.appendEvent('student_session_closed', { reason: 'manual_close' });

			await vscode.window.showInformationMessage(
				t('All your work is saved. You can safely close VS Code now.')
			);
		})
	);
}

function findDirtyActivityDocuments(root: string): vscode.TextDocument[] {
	return vscode.workspace.textDocuments.filter(document => isWithinActivity(root, document));
}

function isWithinActivity(root: string, document: vscode.TextDocument): boolean {
	if (!document.isDirty || document.uri.scheme !== 'file') {
		return false;
	}
	const relativePath = relativeWorkspacePath(root, document.uri.fsPath);
	return relativePath !== '..'
		&& !relativePath.startsWith('../')
		&& !path.isAbsolute(relativePath)
		&& !isIgnoredPath(relativePath);
}
