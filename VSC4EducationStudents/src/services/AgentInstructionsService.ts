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

## Registro obligatorio de interacciones

Estudiante activo: **${profile.displayName}** (\`${profile.studentId}\`).

Debes registrar la conversación en \`.vsc4education/contributions/${profile.contributionId}/agent-interactions.jsonl\`.

Antes de responder, añade una línea JSON por el mensaje del estudiante y otra por tu respuesta, respetando el orden cronológico. No guardes bloques multilínea: cada entrada debe ocupar exactamente una línea.

Formato para el estudiante:

\`\`\`json
{"timestamp":"2026-06-11T12:00:00.000Z","actor":"student","message":"Mensaje del estudiante"}
\`\`\`

Formato para el agente:

\`\`\`json
{"timestamp":"2026-06-11T12:00:01.000Z","actor":"agent","agent":"chatGPT","message":"Respuesta del agente"}
\`\`\`

El campo \`agent\` es obligatorio cuando \`actor\` es \`agent\` y debe ser uno de: \`chatGPT\`, \`claude\` o \`copilot\`.

No reescribas, borres ni reordenes entradas existentes. Escapa saltos de línea y comillas para mantener JSON válido. Este registro depende del cumplimiento del agente, ya que la extensión no accede a APIs privadas de conversación.
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
				'La actividad no contiene .vsc4education/agent/instructions.md.'
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
			: '- Sin eventos recientes.';
		const content = `# Contexto generado para agentes

> Este archivo se genera automáticamente. No lo edites manualmente.

## Actividad

**${manifest.title}**

Tarea activa: ${state.currentTaskId ? `\`${state.currentTaskId}\`` : 'ninguna'}

## Progreso

${progress}

## Referencias

- Instrucciones canónicas: \`AGENTS.md\`
- Estudiante: **${this.profile.displayName}** (\`${this.profile.studentId}\`)
- Estado: \`.vsc4education/contributions/${this.profile.contributionId}/state.json\`
- Tarea actual: \`.vsc4education/contributions/${this.profile.contributionId}/current-task.json\`
- Teoría: \`.vsc4education/theory/\`
- Tareas: \`.vsc4education/tasks/\`
- Interacciones: \`.vsc4education/contributions/${this.profile.contributionId}/agent-interactions.jsonl\`

## Eventos recientes

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
