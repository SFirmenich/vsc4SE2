import * as vscode from 'vscode';

export async function runCommand(
	action: () => Promise<void>,
	successMessage?: string
): Promise<void> {
	try {
		await action();
		if (successMessage) {
			await vscode.window.showInformationMessage(successMessage);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await vscode.window.showErrorMessage(`Learning Activity: ${message}`);
	}
}
