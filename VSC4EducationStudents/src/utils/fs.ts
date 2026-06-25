import * as fs from 'fs/promises';
import * as path from 'path';

import { canonicalJson } from './json';

export async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function ensureDirectory(directory: string): Promise<void> {
	await fs.mkdir(directory, { recursive: true });
}

export async function readJson<T>(filePath: string): Promise<T> {
	return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
	await ensureDirectory(path.dirname(filePath));
	const temporaryPath = `${filePath}.tmp`;
	await fs.writeFile(temporaryPath, `${canonicalJson(value)}\n`, 'utf8');
	await fs.rename(temporaryPath, filePath);
}

export async function copyDirectory(source: string, destination: string): Promise<void> {
	if (!await pathExists(source)) {
		return;
	}

	await ensureDirectory(destination);
	await fs.cp(source, destination, { recursive: true, force: true });
}
