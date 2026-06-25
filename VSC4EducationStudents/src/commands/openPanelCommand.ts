import * as vscode from 'vscode';

import { LearningActivityService } from '../services/LearningActivityService';
import { StudentPanel } from '../webview/StudentPanel';

export const OPEN_PANEL_COMMAND = 'learningActivity.openPanel';

export function registerOpenPanelCommand(
	activityService: LearningActivityService
): vscode.Disposable {
	return vscode.commands.registerCommand(OPEN_PANEL_COMMAND, () => {
		StudentPanel.show(activityService);
	});
}
