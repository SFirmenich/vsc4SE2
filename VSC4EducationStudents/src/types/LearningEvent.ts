export interface LearningEventInput {
	event: string;
	taskId?: string | null;
	data?: Record<string, unknown>;
}

export interface LearningEvent extends LearningEventInput {
	id: string;
	studentId: string;
	timestamp: string;
	previousHash: string | null;
	hash: string;
}
