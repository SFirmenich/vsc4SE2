import * as vscode from 'vscode';

export function t(message: string, ...args: Array<string | number | boolean>): string {
	return vscode.l10n.t(message, ...args);
}

export function locale(): string {
	return vscode.env.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export interface StudentPanelStrings {
	language: string;
	noActivity: string;
	loadZip: string;
	loadUrl: string;
	registerRequired: string;
	registerStudent: string;
	student: string;
	startTask: string;
	viewTask: string;
	finishTask: string;
	exportSubmission: string;
	closeSession: string;
	tasks: string;
	panelErrorTitle: string;
	panelErrorDescription: string;
}

export function studentPanelStrings(): StudentPanelStrings {
	return {
		language: locale(),
		noActivity: t('No activity is loaded in this window.'),
		loadZip: t('Load ZIP'),
		loadUrl: t('Load from URL'),
		registerRequired: t('Register your identity before starting tasks or generating evidence.'),
		registerStudent: t('Register student'),
		student: t('Student'),
		startTask: t('Start task'),
		viewTask: t('View task brief'),
		finishTask: t('Finish task'),
		exportSubmission: t('Export submission'),
		closeSession: t('Close session'),
		tasks: t('Tasks'),
		panelErrorTitle: t('Something went wrong while loading the panel.'),
		panelErrorDescription: t('Close this panel and reopen it. If the problem persists, contact your instructor.')
	};
}
