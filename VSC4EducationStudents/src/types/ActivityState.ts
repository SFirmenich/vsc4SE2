export type TaskStatus = 'pending' | 'active' | 'completed';

export interface TaskState {
	status: TaskStatus;
	startedAt?: string;
	finishedAt?: string;
	startCommit?: string;
}

export interface ActivityState {
	studentId: string;
	contributionId: string;
	activityId: string;
	activityTitle: string;
	loadedAt: string;
	currentTaskId: string | null;
	tasks: Record<string, TaskState>;
	lastEventHash: string | null;
	git: {
		enabled: boolean;
		initialCommit?: string;
	};
}
