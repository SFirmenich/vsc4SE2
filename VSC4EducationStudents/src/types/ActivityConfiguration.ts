export interface ActivityConfiguration {
	loadedAt: string;
	gitEnabled: boolean;
	repositoryMode: 'disabled' | 'created' | 'existing';
}
