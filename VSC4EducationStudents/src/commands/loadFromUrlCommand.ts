import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { ActivityLoader } from '../services/ActivityLoader';
import { LearningActivityService } from '../services/LearningActivityService';
import { ZipService } from '../services/ZipService';
import { runCommand } from './commandUtils';
import { loadSelectedZip } from './loadFromZipCommand';

export const LOAD_FROM_URL_COMMAND = 'learningActivity.loadFromUrl';

export function registerLoadFromUrlCommand(
	zipService: ZipService,
	loader: ActivityLoader,
	activityService: LearningActivityService
): vscode.Disposable {
	return vscode.commands.registerCommand(LOAD_FROM_URL_COMMAND, () => runCommand(async () => {
		const url = await vscode.window.showInputBox({
			prompt: 'URL HTTPS/HTTP del archivo ZIP de la actividad',
			placeHolder: 'https://example.org/actividad.zip',
			validateInput: value => {
				try {
					const parsed = new URL(value);
					return ['http:', 'https:'].includes(parsed.protocol)
						? undefined
						: 'La URL debe usar HTTP o HTTPS.';
				} catch {
					return 'Introduce una URL válida.';
				}
			}
		});
		if (!url) {
			return;
		}

		const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'learning-download-'));
		const zipPath = path.join(temporaryDirectory, 'activity.zip');
		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Descargando actividad...',
					cancellable: false
				},
				() => zipService.download(url, zipPath)
			);
			await loadSelectedZip(zipPath, loader, activityService);
		} finally {
			await fs.rm(temporaryDirectory, { recursive: true, force: true });
		}
	}));
}
