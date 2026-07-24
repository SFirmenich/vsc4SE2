import * as path from 'path';
import * as stream from 'stream';
import { promisify } from 'util';
import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as fsp from 'fs/promises';

import { ensureDirectory } from '../utils/fs';

const pipeline = promisify(stream.pipeline);

export class ZipService {
	public async extract(zipPath: string, destination: string): Promise<void> {
		await ensureDirectory(destination);
		const zip = new AdmZip(zipPath);
		for (const entry of zip.getEntries()) {
			const resolved = path.resolve(destination, entry.entryName);
			const destinationRoot = `${path.resolve(destination)}${path.sep}`;
			if (resolved !== path.resolve(destination) && !resolved.startsWith(destinationRoot)) {
				throw new Error(`El ZIP contiene una ruta no segura: ${entry.entryName}`);
			}
		}
		zip.extractAllTo(destination, true);
	}

	public async create(sourceDirectory: string, outputPath: string): Promise<void> {
		await ensureDirectory(path.dirname(outputPath));
		const zip = new AdmZip();
		await this.addDirectory(zip, sourceDirectory, sourceDirectory);
		await new Promise<void>((resolve, reject) => {
			zip.writeZip(outputPath, error => {
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			});
		});
	}

	private async addDirectory(zip: AdmZip, root: string, current: string): Promise<void> {
		for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			const relative = path.relative(root, full).replace(/\\/g, '/');
			if (this.isExcludedFromSubmission(relative)) {
				continue;
			}
			if (entry.isDirectory()) {
				await this.addDirectory(zip, root, full);
			} else {
				zip.addLocalFile(full, path.dirname(relative) === '.' ? '' : path.dirname(relative));
			}
		}
	}

	private isExcludedFromSubmission(relativePath: string): boolean {
		return /^\.vsc4education\/contributions\/[^/]+\/event-server-session\.json$/i.test(relativePath);
	}

	public async download(url: string, outputPath: string): Promise<void> {
		const response = await fetch(url, { redirect: 'follow' });
		if (!response.ok || !response.body) {
			throw new Error(`No se pudo descargar la actividad: HTTP ${response.status}.`);
		}
		await ensureDirectory(path.dirname(outputPath));
		await pipeline(
			stream.Readable.fromWeb(response.body as never),
			fs.createWriteStream(outputPath)
		);
	}
}
