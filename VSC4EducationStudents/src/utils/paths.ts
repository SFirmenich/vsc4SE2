import * as path from 'path';

export const LEARNING_DIRECTORY = '.vsc4education';

export function learningPath(root: string, ...segments: string[]): string {
	return path.join(root, LEARNING_DIRECTORY, ...segments);
}

export function contributionsPath(root: string, ...segments: string[]): string {
	return learningPath(root, 'contributions', ...segments);
}

export function contributionPath(
	root: string,
	contributionId: string,
	...segments: string[]
): string {
	return contributionsPath(root, contributionId, ...segments);
}

export function statePath(root: string, contributionId: string): string {
	return contributionPath(root, contributionId, 'state.json');
}

export function eventsPath(root: string, contributionId: string): string {
	return contributionPath(root, contributionId, 'events.jsonl');
}

export function manifestPath(root: string): string {
	return learningPath(root, 'activity-manifest.json');
}

export function activityConfigurationPath(root: string): string {
	return learningPath(root, 'activity-configuration.json');
}

export function relativeWorkspacePath(root: string, filePath: string): string {
	return path.relative(root, filePath).split(path.sep).join('/');
}

export function isIgnoredPath(relativePath: string): boolean {
	const normalized = relativePath.replace(/\\/g, '/');
	return /^\.vsc4education\/contributions\/[^/]+\/(events|agent-evidence|agent-evidence-state|state|current-task)\.jsonl?$/.test(normalized)
		|| /^\.vsc4education\/contributions\/[^/]+\/task-metadata\//.test(normalized)
		|| normalized.startsWith('node_modules/')
		|| normalized.startsWith('.git/')
		|| normalized.startsWith('dist/')
		|| normalized.startsWith('out/');
}
