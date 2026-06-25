import * as vscode from 'vscode';

import { LearningActivityService } from '../services/LearningActivityService';
import { runCommand } from './commandUtils';

export const START_TASK_COMMAND = 'learningActivity.startTask';

export function registerStartTaskCommand(
	activityService: LearningActivityService
): vscode.Disposable {
	return vscode.commands.registerCommand(
		START_TASK_COMMAND,
		(taskId?: string) => runCommand(async () => {
			const selectedTaskId = taskId ?? await pickTask(activityService);
			if (!selectedTaskId) {
				return;
			}
			await activityService.startTask(selectedTaskId);
			await vscode.window.showInformationMessage(`Tarea iniciada: ${selectedTaskId}`);
		})
	);
}

async function pickTask(
	activityService: LearningActivityService
): Promise<string | undefined> {
	const snapshot = await activityService.getSnapshot();
	if (!snapshot) {
		throw new Error('No hay una actividad cargada.');
	}
	if (!snapshot.profile || !snapshot.state) {
		throw new Error('Debes registrar al estudiante antes de empezar una tarea.');
	}
	const state = snapshot.state;
	const selected = await vscode.window.showQuickPick(
		snapshot.manifest.tasks
			.filter(task => state.tasks[task.id]?.status === 'pending')
			.map(task => ({ label: task.title, description: task.id, taskId: task.id })),
		{ placeHolder: 'Selecciona la tarea que quieres empezar' }
	);
	return selected?.taskId;
}
