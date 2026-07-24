import * as vscode from 'vscode';

import { t } from '../i18n';
import { LearningActivityService } from '../services/LearningActivityService';
import { runCommand } from './commandUtils';

export const REGISTER_STUDENT_COMMAND = 'learningActivity.registerStudent';

export function registerStudentCommand(
	activityService: LearningActivityService
): vscode.Disposable {
	return vscode.commands.registerCommand(REGISTER_STUDENT_COMMAND, () => runCommand(async () => {
		const studentId = await vscode.window.showInputBox({
			title: t('Register student'),
			prompt: t('Institutional identifier'),
			ignoreFocusOut: true,
			validateInput: value => value.trim() ? undefined : t('The identifier is required.')
		});
		if (!studentId) {
			return;
		}
		const firstName = await vscode.window.showInputBox({
			title: t('Register student'),
			prompt: t('First name'),
			ignoreFocusOut: true,
			validateInput: value => value.trim() ? undefined : t('First name is required.')
		});
		if (!firstName) {
			return;
		}
		const lastName = await vscode.window.showInputBox({
			title: t('Register student'),
			prompt: t('Last name'),
			ignoreFocusOut: true,
			validateInput: value => value.trim() ? undefined : t('Last name is required.')
		});
		if (!lastName) {
			return;
		}
		const profile = await activityService.registerStudent({
			studentId,
			firstName,
			lastName
		});
		await vscode.window.showInformationMessage(
			t('Active student: {0} ({1})', profile.displayName, profile.studentId)
		);
	}));
}
