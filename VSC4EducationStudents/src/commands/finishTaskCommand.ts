import * as vscode from 'vscode';

import { t } from '../i18n';
import { LearningActivityService } from '../services/LearningActivityService';
import { runCommand } from './commandUtils';

export const FINISH_TASK_COMMAND = 'learningActivity.finishTask';

export function registerFinishTaskCommand(
	activityService: LearningActivityService
): vscode.Disposable {
	return vscode.commands.registerCommand(
		FINISH_TASK_COMMAND,
		(taskId?: string) => runCommand(async () => {
			const snapshot = await activityService.getSnapshot();
			const selectedTaskId = taskId ?? snapshot?.state?.currentTaskId;
			if (!selectedTaskId) {
				throw new Error(t('There is no active task.'));
			}
			const metadata = await activityService.finishTask(selectedTaskId);
			await vscode.window.showInformationMessage(
				t('Task finished: {0} ({1} min)', selectedTaskId, metadata.durationMinutes)
			);
		})
	);
}
