import * as path from 'path';
import * as vscode from 'vscode';

import { LearningActivityService } from '../services/LearningActivityService';
import { ZipService } from '../services/ZipService';
import { runCommand } from './commandUtils';

export const EXPORT_SUBMISSION_COMMAND = 'learningActivity.exportSubmission';

export function registerExportSubmissionCommand(
	activityService: LearningActivityService,
	zipService: ZipService
): vscode.Disposable {
	return vscode.commands.registerCommand(EXPORT_SUBMISSION_COMMAND, () => runCommand(async () => {
		const snapshot = await activityService.getSnapshot();
		if (!snapshot) {
			throw new Error('No hay una actividad cargada.');
		}
		if (!snapshot.profile || !snapshot.state) {
			throw new Error('Debes registrar al estudiante antes de exportar.');
		}
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const destination = await vscode.window.showSaveDialog({
			defaultUri: vscode.Uri.file(path.join(
				path.dirname(snapshot.root),
				`submission-${snapshot.state.activityId}-${snapshot.profile.studentId}-${timestamp}.zip`
			)),
			filters: { 'Entrega ZIP': ['zip'] },
			saveLabel: 'Exportar entrega'
		});
		if (!destination) {
			return;
		}
		await activityService.prepareSubmissionExport(path.basename(destination.fsPath));
		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Exportando entrega...',
					cancellable: false
				},
				() => zipService.create(snapshot.root, destination.fsPath)
			);
		} finally {
			activityService.finishSubmissionExport();
		}
		await vscode.window.showInformationMessage(`Entrega exportada en ${destination.fsPath}`);
	}));
}
