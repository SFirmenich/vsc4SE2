import * as vscode from 'vscode';

import { LearningActivityService } from './LearningActivityService';

export class HeartbeatService implements vscode.Disposable {
	private timer: NodeJS.Timeout | undefined;

	public constructor(private readonly activityService: LearningActivityService) {
		this.restart();
	}

	public restart(): void {
		if (this.timer) {
			clearInterval(this.timer);
		}
		const seconds = Math.max(
			5,
			vscode.workspace.getConfiguration('learningActivity')
				.get<number>('heartbeatIntervalSeconds', 30)
		);
		this.timer = setInterval(() => {
			if (this.activityService.getRoot()) {
				void this.activityService.appendEvent('heartbeat').catch(() => undefined);
			}
		}, seconds * 1000);
	}

	public dispose(): void {
		if (this.timer) {
			clearInterval(this.timer);
		}
	}
}
