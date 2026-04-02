import type { StorageBackend } from './storageBackend';

/**
 * Storage backend using the Origin Private File System (OPFS).
 * Wraps the existing opfslib utilities.
 */
export class OPFSBackend implements StorageBackend {
	async readFile(filename: string): Promise<string | undefined> {
		const handle = await this.getHandle(filename);
		if (!handle) return undefined;

		const file = await handle.getFile();
		return file.text();
	}

	async writeFile(filename: string, content: string): Promise<void> {
		const handle = await this.getHandle(filename, true);
		if (!handle) throw new Error(`Cannot create file: ${filename}`);

		const stream = await handle.createWritable();
		await stream.write(new TextEncoder().encode(content));
		await stream.close();
	}

	async listFiles(): Promise<string[]> {
		const root = await navigator.storage.getDirectory();
		const files: string[] = [];

		// @ts-expect-error - FileSystemDirectoryHandle.entries() is part of the File System Access API
		for await (const [name, handle] of root.entries()) {
			if (handle.kind === 'file') {
				files.push(name);
			}
		}

		return files;
	}

	async lastModified(filename: string): Promise<number | undefined> {
		const handle = await this.getHandle(filename);
		if (!handle) return undefined;

		const file = await handle.getFile();
		return file.lastModified;
	}

	private async getHandle(
		filename: string,
		create: boolean = false
	): Promise<FileSystemFileHandle | undefined> {
		try {
			const root = await navigator.storage.getDirectory();
			return await root.getFileHandle(filename, { create });
		} catch (error: any) {
			if (error.name === 'NotFoundError') return undefined;
			console.error('OPFS error:', error);
			return undefined;
		}
	}
}
