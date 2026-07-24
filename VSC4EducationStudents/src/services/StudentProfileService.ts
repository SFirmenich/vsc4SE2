import * as path from 'path';
import * as vscode from 'vscode';

import { StudentProfile } from '../types/StudentProfile';
import { pathExists, readJson, writeJson } from '../utils/fs';
import { contributionPath } from '../utils/paths';

const ACTIVE_STUDENTS_KEY = 'learningActivity.activeStudents';

export class StudentProfileService {
	public constructor(private readonly workspaceState: vscode.Memento) {}

	public async register(
		root: string,
		input: Pick<StudentProfile, 'studentId' | 'firstName' | 'lastName'>
	): Promise<StudentProfile> {
		const studentId = this.normalizeId(input.studentId);
		const contributionId = studentId;
		const active = this.workspaceState.get<Record<string, string>>(ACTIVE_STUDENTS_KEY, {});
		const currentContribution = active[this.rootKey(root)];
		if (currentContribution && currentContribution !== contributionId) {
			throw new Error(
				`This workspace is already linked to student "${currentContribution}".`
			);
		}
		const profilePath = contributionPath(root, contributionId, 'profile.json');
		const existing = await pathExists(profilePath)
			? await readJson<StudentProfile>(profilePath)
			: undefined;
		const profile: StudentProfile = {
			studentId,
			firstName: input.firstName.trim(),
			lastName: input.lastName.trim(),
			displayName: `${input.firstName.trim()} ${input.lastName.trim()}`.trim(),
			contributionId,
			registeredAt: existing?.registeredAt ?? new Date().toISOString()
		};
		await writeJson(profilePath, profile);
		active[this.rootKey(root)] = contributionId;
		await this.workspaceState.update(ACTIVE_STUDENTS_KEY, active);
		return profile;
	}

	public async getActive(root: string): Promise<StudentProfile | undefined> {
		const active = this.workspaceState.get<Record<string, string>>(ACTIVE_STUDENTS_KEY, {});
		const contributionId = active[this.rootKey(root)];
		if (!contributionId) {
			return undefined;
		}
		const profilePath = contributionPath(root, contributionId, 'profile.json');
		return await pathExists(profilePath)
			? readJson<StudentProfile>(profilePath)
			: undefined;
	}

	public async setActive(root: string, contributionId: string): Promise<void> {
		const profilePath = contributionPath(root, contributionId, 'profile.json');
		if (!await pathExists(profilePath)) {
			throw new Error(`Contribution "${contributionId}" does not exist.`);
		}
		const active = this.workspaceState.get<Record<string, string>>(ACTIVE_STUDENTS_KEY, {});
		active[this.rootKey(root)] = contributionId;
		await this.workspaceState.update(ACTIVE_STUDENTS_KEY, active);
	}

	private normalizeId(value: string): string {
		const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
		if (!normalized || !/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
			throw new Error('The student identifier is not valid.');
		}
		return normalized;
	}

	private rootKey(root: string): string {
		return path.resolve(root).toLowerCase();
	}
}
