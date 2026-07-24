import * as fs from 'fs/promises';
import * as path from 'path';

import { ActivityManifest } from '../types/ActivityManifest';
import { ActivityState } from '../types/ActivityState';
import { LearningEvent } from '../types/LearningEvent';
import { StudentProfile } from '../types/StudentProfile';
import { ensureDirectory, pathExists, writeJson } from '../utils/fs';
import { contributionPath, learningPath } from '../utils/paths';

const TRACE_INSTRUCTIONS_MARKER = '<!-- VSC4EDUCATION_AGENT_TRACE_V1 -->';

function getTraceInstructions(profile: StudentProfile): string {
	return `${TRACE_INSTRUCTIONS_MARKER}

## Required interaction logging

Active student: **${profile.displayName}** (\`${profile.studentId}\`).

You must record the conversation in \`.vsc4education/contributions/${profile.contributionId}/agent-interactions.jsonl\`.

Before answering, add one JSON line for the student's message and one JSON line for your response, preserving chronological order. Do not store multiline blocks: each entry must occupy exactly one line.

Student format:

\`\`\`json
{"timestamp":"2026-06-11T12:00:00.000Z","actor":"student","message":"Student message"}
\`\`\`

Agent format:

\`\`\`json
{"timestamp":"2026-06-11T12:00:01.000Z","actor":"agent","agent":"chatGPT","message":"Agent response"}
\`\`\`

The \`agent\` field is required when \`actor\` is \`agent\` and must be one of: \`chatGPT\`, \`claude\`, or \`copilot\`.

Do not rewrite, delete, or reorder existing entries. Escape line breaks and quotes to keep JSON valid. This log depends on agent compliance because the extension does not access private conversation APIs.
`;
}

export class AgentInstructionsService {
	public constructor(
		private readonly root: string,
		private readonly profile: StudentProfile
	) {}

	public async generate(
		manifest: ActivityManifest,
		state: ActivityState,
		recentEvents: LearningEvent[]
	): Promise<void> {
		const canonicalInstructions = await this.getCanonicalInstructions();
		await this.ensureInteractionLog();
		await this.ensureRootInstructions(canonicalInstructions);
		await this.writeGeneratedContext(manifest, state, recentEvents);
		await this.writeCurrentTask(manifest, state);
	}

	public async ensureRootInstructions(
		canonicalInstructions?: string
	): Promise<boolean> {
		const expected = canonicalInstructions ?? await this.getCanonicalInstructions();
		const instructionsPath = learningPath(this.root, 'agent', 'instructions.md');
		const agentsPath = path.join(this.root, 'AGENTS.md');
		const currentInstructions = await pathExists(instructionsPath)
			? await fs.readFile(instructionsPath, 'utf8')
			: undefined;
		const currentAgents = await pathExists(agentsPath)
			? await fs.readFile(agentsPath, 'utf8')
			: undefined;
		if (currentInstructions === expected && currentAgents === expected) {
			return false;
		}
		if (currentInstructions !== expected) {
			await fs.writeFile(instructionsPath, expected, 'utf8');
		}
		await fs.writeFile(agentsPath, expected, 'utf8');
		return true;
	}

	public async getCanonicalInstructions(): Promise<string> {
		const instructionsPath = learningPath(this.root, 'agent', 'instructions.md');
		const masterPath = learningPath(this.root, 'agent', 'instructions.master.md');
		let baseInstructions: string;
		if (await pathExists(masterPath)) {
			baseInstructions = await fs.readFile(masterPath, 'utf8');
		} else if (await pathExists(instructionsPath)) {
			baseInstructions = await fs.readFile(instructionsPath, 'utf8');
			const markerIndex = baseInstructions.indexOf(TRACE_INSTRUCTIONS_MARKER);
			if (markerIndex >= 0) {
				baseInstructions = baseInstructions.slice(0, markerIndex).trimEnd();
			}
			await fs.writeFile(masterPath, `${baseInstructions.trimEnd()}\n`, 'utf8');
		} else {
			throw new Error(
				'The activity does not contain .vsc4education/agent/instructions.md.'
			);
		}
		const canonical = `${baseInstructions.trimEnd()}\n\n${getTraceInstructions(this.profile)}`;
		await fs.writeFile(instructionsPath, canonical, 'utf8');
		return canonical;
	}

	private async ensureInteractionLog(): Promise<void> {
		const logPath = contributionPath(
			this.root,
			this.profile.contributionId,
			'agent-interactions.jsonl'
		);
		if (!await pathExists(logPath)) {
			await ensureDirectory(path.dirname(logPath));
			await fs.writeFile(logPath, '', 'utf8');
		}
	}

	private async writeGeneratedContext(
		manifest: ActivityManifest,
		state: ActivityState,
		recentEvents: LearningEvent[]
	): Promise<void> {
		const progress = manifest.tasks
			.map(task =>
				`- ${task.title} (\`${task.id}\`): ${state.tasks[task.id]?.status ?? 'pending'}`
			)
			.join('\n');
		const eventSummary = recentEvents.length > 0
			? recentEvents
				.map(event =>
					`- ${event.timestamp}: ${event.event}${event.taskId ? ` [${event.taskId}]` : ''}`
				)
				.join('\n')
			: '- No recent events.';
		const content = `# Generated Agent Context

> This file is generated automatically. Do not edit it manually.

## Activity

**${manifest.title}**

Active task: ${state.currentTaskId ? `\`${state.currentTaskId}\`` : 'none'}

## Progress

${progress}

## References

- Canonical instructions: \`AGENTS.md\`
- Student: **${this.profile.displayName}** (\`${this.profile.studentId}\`)
- State: \`.vsc4education/contributions/${this.profile.contributionId}/state.json\`
- Current task: \`.vsc4education/contributions/${this.profile.contributionId}/current-task.json\`
- Theory: \`.vsc4education/theory/\`
- Tasks: \`.vsc4education/tasks/\`
- Interactions: \`.vsc4education/contributions/${this.profile.contributionId}/agent-interactions.jsonl\`

## Recent Events

${eventSummary}
`;
		await fs.writeFile(
			contributionPath(
				this.root,
				this.profile.contributionId,
				'AGENTS.generated.md'
			),
			content,
			'utf8'
		);
	}

	private async writeCurrentTask(
		manifest: ActivityManifest,
		state: ActivityState
	): Promise<void> {
		const currentTaskPath = contributionPath(
			this.root,
			this.profile.contributionId,
			'current-task.json'
		);
		if (state.currentTaskId) {
			const task = manifest.tasks.find(candidate => candidate.id === state.currentTaskId);
			await writeJson(currentTaskPath, {
				taskId: state.currentTaskId,
				title: task?.title ?? state.currentTaskId,
				description: task?.description,
				startedAt: state.tasks[state.currentTaskId]?.startedAt
			});
		} else if (await pathExists(currentTaskPath)) {
			await fs.unlink(currentTaskPath);
		}
	}
}
