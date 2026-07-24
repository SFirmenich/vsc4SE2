import * as vscode from 'vscode';

import { registerExportSubmissionCommand } from './commands/exportSubmissionCommand';
import { registerFinishTaskCommand } from './commands/finishTaskCommand';
import { registerLoadFromUrlCommand } from './commands/loadFromUrlCommand';
import { registerLoadFromZipCommand } from './commands/loadFromZipCommand';
import { registerOpenPanelCommand } from './commands/openPanelCommand';
import { registerStudentCommand } from './commands/registerStudentCommand';
import { registerStartTaskCommand } from './commands/startTaskCommand';
import { ActivityLoader } from './services/ActivityLoader';
import { AgentInstructionsGuardService } from './services/AgentInstructionsGuardService';
import { AgentEvidenceService } from './services/AgentEvidenceService';
import { HeartbeatService } from './services/HeartbeatService';
import { LearningActivityService } from './services/LearningActivityService';
import { TrackingService } from './services/TrackingService';
import { StudentProfileService } from './services/StudentProfileService';
import { ZipService } from './services/ZipService';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const zipService = new ZipService();
	const loader = new ActivityLoader(zipService);
	const profileService = new StudentProfileService(context.workspaceState);
	const activityService = new LearningActivityService(profileService);
	const agentEvidenceService = new AgentEvidenceService(activityService);

	context.subscriptions.push(
		registerLoadFromZipCommand(loader, activityService),
		registerLoadFromUrlCommand(zipService, loader, activityService),
		registerOpenPanelCommand(activityService),
		registerStudentCommand(activityService),
		registerStartTaskCommand(activityService),
		registerFinishTaskCommand(activityService),
		registerExportSubmissionCommand(activityService, zipService, agentEvidenceService)
	);

	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		if (await activityService.useRootIfActivity(folder.uri.fsPath)) {
			break;
		}
	}

	const trackingService = new TrackingService(activityService);
	const heartbeatService = new HeartbeatService(activityService);
	const agentInstructionsGuard = new AgentInstructionsGuardService(activityService);
	context.subscriptions.push(
		trackingService,
		heartbeatService,
		agentEvidenceService,
		agentInstructionsGuard,
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('learningActivity.heartbeatIntervalSeconds')) {
				heartbeatService.restart();
			}
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(async event => {
			for (const folder of event.added) {
				if (await activityService.useRootIfActivity(folder.uri.fsPath)) {
					return;
				}
			}
		})
	);
}

export function deactivate() {}
