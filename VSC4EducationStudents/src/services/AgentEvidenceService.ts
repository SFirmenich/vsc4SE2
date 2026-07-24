import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { randomUUID } from 'crypto';

import { AgentEvidenceEntry } from '../types/Evidence';
import { sha256 } from '../utils/crypto';
import { ensureDirectory, pathExists, readJson, writeJson } from '../utils/fs';
import { canonicalJson } from '../utils/json';
import { contributionPath } from '../utils/paths';
import { EvidenceEncryptionService } from './EvidenceEncryptionService';
import { LearningActivityService } from './LearningActivityService';

interface AgentEvidenceState {
	processedLines: number;
	lastHash: string | null;
}

export class AgentEvidenceService implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private readonly queues = new Map<string, Promise<void>>();

	public constructor(private readonly activityService: LearningActivityService) {
		const watcher = vscode.workspace.createFileSystemWatcher(
			'**/.vsc4education/contributions/*/agent-interactions.jsonl'
		);
		this.disposables.push(
			watcher,
			watcher.onDidChange(uri => void this.syncPath(uri.fsPath).catch(() => undefined)),
			watcher.onDidCreate(uri => void this.syncPath(uri.fsPath).catch(() => undefined))
		);
	}

	public dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	public async syncActiveContribution(): Promise<void> {
		const root = this.activityService.getRoot();
		const profile = await this.activityService.getActiveProfile();
		if (!root || !profile) {
			return;
		}
		await this.sync(root, profile.contributionId);
	}

	private async syncPath(filePath: string): Promise<void> {
		const normalized = filePath.replace(/\\/g, '/');
		const match = /^(.*)\/\.vsc4education\/contributions\/([^/]+)\/agent-interactions\.jsonl$/i.exec(normalized);
		if (!match) {
			return;
		}
		await this.sync(match[1], match[2]);
	}

	private async sync(root: string, contributionId: string): Promise<void> {
		const key = `${root}:${contributionId}`;
		const previous = this.queues.get(key) ?? Promise.resolve();
		const current = previous.catch(() => undefined).then(() =>
			this.syncImmediately(root, contributionId)
		);
		this.queues.set(key, current);
		try {
			await current;
		} finally {
			if (this.queues.get(key) === current) {
				this.queues.delete(key);
			}
		}
	}

	private async syncImmediately(root: string, contributionId: string): Promise<void> {
		const source = contributionPath(root, contributionId, 'agent-interactions.jsonl');
		if (!await pathExists(source)) {
			return;
		}
		const encryption = new EvidenceEncryptionService(root);
		const keyId = await encryption.keyId();
		if (!keyId) {
			return;
		}
		const statePath = contributionPath(root, contributionId, 'agent-evidence-state.json');
		const evidencePath = contributionPath(root, contributionId, 'agent-evidence.jsonl');
		const state = await this.loadState(statePath);
		const lines = (await fs.readFile(source, 'utf8')).split(/\r?\n/);
		const completeLines = lines.at(-1) === '' ? lines.slice(0, -1) : lines;
		if (completeLines.length < state.processedLines) {
			state.processedLines = 0;
			state.lastHash = null;
			await fs.writeFile(evidencePath, '', 'utf8');
		}
		await ensureDirectory(path.dirname(evidencePath));
		for (let index = state.processedLines; index < completeLines.length; index += 1) {
			const line = completeLines[index].trim();
			if (!line) {
				state.processedLines += 1;
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				break;
			}
			const base = {
				id: randomUUID(),
				schema: 'vsc4e.agent-evidence.encrypted.v1' as const,
				source: 'agent-interactions.jsonl' as const,
				sourceLine: index + 1,
				keyId,
				plaintextHash: sha256(line),
				data: await encryption.encryptJson({ line: parsed }),
				previousHash: state.lastHash
			};
			const entry: AgentEvidenceEntry = {
				...base,
				hash: sha256(`${state.lastHash ?? ''}${canonicalJson(base)}`)
			};
			await fs.appendFile(evidencePath, `${JSON.stringify(entry)}\n`, 'utf8');
			state.processedLines = index + 1;
			state.lastHash = entry.hash;
		}
		await writeJson(statePath, state);
	}

	private async loadState(target: string): Promise<AgentEvidenceState> {
		if (!await pathExists(target)) {
			return { processedLines: 0, lastHash: null };
		}
		const value = await readJson<Partial<AgentEvidenceState>>(target);
		return {
			processedLines: typeof value.processedLines === 'number' ? value.processedLines : 0,
			lastHash: typeof value.lastHash === 'string' ? value.lastHash : null
		};
	}
}
