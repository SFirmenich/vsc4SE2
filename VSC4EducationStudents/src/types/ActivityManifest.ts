export interface ActivityTask {
	id: string;
	title: string;
	description?: string;
	file?: string;
}

export interface ActivityManifest {
	id: string;
	title: string;
	description?: string;
	version?: string;
	tasks: ActivityTask[];
}
