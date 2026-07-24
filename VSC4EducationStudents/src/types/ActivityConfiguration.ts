import { RepositoryEventServerConfiguration } from './ActivityManifest';

export interface ActivityConfiguration {
	loadedAt: string;
	gitEnabled: boolean;
	repositoryMode: 'disabled' | 'created' | 'existing';
	repository?: {
		eventServer?: RepositoryEventServerConfiguration;
	};
}
