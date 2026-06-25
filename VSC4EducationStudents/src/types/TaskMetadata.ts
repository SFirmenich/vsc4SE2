export interface TaskMetadata {
	taskId: string;
	startedAt: string;
	finishedAt: string;
	durationMinutes: number;
	modifiedFiles: string[];
	fileSavedEvents: number;
	startCommit?: string;
	finishCommit?: string;
}
