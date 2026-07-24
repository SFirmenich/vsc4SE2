export interface ActivityTask {
	id: string;
	title: string;
	description?: string;
	file?: string;
}

export interface RepositoryEventServerConfiguration {
	enabled: boolean;
	baseUrl: string;
	activityVersionId?: number;
	ingestionToken?: string;
	publicSigningKeyUrl?: string;
	expectedSigningKeyId?: string;
	expectedPublicKeySha256?: string;
	publicSigningKey?: Record<string, unknown>;
	requireReceipts?: boolean;
}

export interface ActivityManifest {
	id: string;
	title: string;
	description?: string;
	version?: string;
	repository?: {
		eventServer?: RepositoryEventServerConfiguration;
	};
	tasks: ActivityTask[];
}
