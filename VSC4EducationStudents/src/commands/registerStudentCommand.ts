import * as vscode from 'vscode';

import { LearningActivityService } from '../services/LearningActivityService';
import { runCommand } from './commandUtils';

export const REGISTER_STUDENT_COMMAND = 'learningActivity.registerStudent';

export function registerStudentCommand(
	activityService: LearningActivityService
): vscode.Disposable {
	return vscode.commands.registerCommand(REGISTER_STUDENT_COMMAND, () => runCommand(async () => {
		const studentId = await vscode.window.showInputBox({
			title: 'Registrar estudiante',
			prompt: 'Identificador institucional',
			ignoreFocusOut: true,
			validateInput: value => value.trim() ? undefined : 'El identificador es obligatorio.'
		});
		if (!studentId) {
			return;
		}
		const firstName = await vscode.window.showInputBox({
			title: 'Registrar estudiante',
			prompt: 'Nombre',
			ignoreFocusOut: true,
			validateInput: value => value.trim() ? undefined : 'El nombre es obligatorio.'
		});
		if (!firstName) {
			return;
		}
		const lastName = await vscode.window.showInputBox({
			title: 'Registrar estudiante',
			prompt: 'Apellido',
			ignoreFocusOut: true,
			validateInput: value => value.trim() ? undefined : 'El apellido es obligatorio.'
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
			`Estudiante activo: ${profile.displayName} (${profile.studentId})`
		);
	}));
}
