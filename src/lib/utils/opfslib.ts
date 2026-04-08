/*
Utilities to work with OPFS
*/

export async function readFile(filename: string) {
	const fileHandle = await getHandle(filename);
	if (!fileHandle) {
		console.warn('File could not be opened', filename);
		return;
	}

	const file = await fileHandle.getFile();
	const contents = await file.text();

	return contents;
}

export async function saveFile(filename: string, content: string) {
	const stream = await openWrite(filename);
	const data = new TextEncoder().encode(content);
	await stream?.write(data);
	await stream?.close();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function openRead(filename: string) {
	const fileHandle = getHandle(filename);
	if (!fileHandle) {
		console.warn('File could not be opened', filename);
		return;
	}
}

async function openWrite(filename: string, create: boolean = true) {
	const fileHandle = await getHandle(filename, create);
	if (!fileHandle) {
		console.warn('File could not be opened', filename);
		return;
	}

	const stream = await fileHandle.createWritable();
	return stream;
}

async function getHandle(filename: string, create: boolean = false) {
	try {
		const root = await navigator.storage.getDirectory();
		const parts = filename.split('/');
		const name = parts.pop()!;

		let dir: FileSystemDirectoryHandle = root;
		for (const part of parts) {
			dir = await dir.getDirectoryHandle(part, { create });
		}

		return await dir.getFileHandle(name, { create });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (error: any) {
		if (error.name === 'NotFoundError') {
			console.log('The file does not exist: ', filename);
		} else {
			console.error('An error occurred:', error);
		}
	}

	return undefined;
}

export async function listFiles(): Promise<string[]> {
	try {
		const root = await navigator.storage.getDirectory();
		const files: string[] = [];

		// Iterate through directory entries using the async iterator
		for await (const [name, handle] of root.entries()) {
			if (handle.kind === 'file') {
				files.push(name);
			}
		}

		return files;
	} catch (error) {
		console.error('Error listing files:', error);
		return [];
	}
}

export interface FileTreeEntry {
	name: string;
	kind: 'file' | 'directory';
	path: string; // relative path from root, e.g. "subdir/file.txt"
	depth: number; // nesting level for indentation
	size?: number;
	lastModified?: number;
	expanded?: boolean;
}

export async function listFileTree(): Promise<FileTreeEntry[]> {
	try {
		const root = await navigator.storage.getDirectory();
		const entries: FileTreeEntry[] = [];

		async function walkDirectory(dirHandle: FileSystemDirectoryHandle, prefix: string, depth: number) {
			const items: FileTreeEntry[] = [];

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			for await (const [name, handle] of (dirHandle as any).entries()) {
				const path = prefix ? `${prefix}/${name}` : name;
				const entry: FileTreeEntry = { name, kind: handle.kind, path, depth };

				if (handle.kind === 'file') {
					try {
						const file = await (handle as FileSystemFileHandle).getFile();
						entry.size = file.size;
						entry.lastModified = file.lastModified;
					} catch {
						// metadata unavailable
					}
				}

				items.push(entry);
			}

			// Sort: directories first, then files, alphabetically
			items.sort((a, b) => {
				if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
				return a.name.localeCompare(b.name);
			});

			// Push each item and immediately recurse into directories
			// so children appear right after their parent
			for (const item of items) {
				entries.push(item);

				if (item.kind === 'directory') {
					try {
						const subDir = await dirHandle.getDirectoryHandle(item.name);
						await walkDirectory(subDir, item.path, item.depth + 1);
					} catch {
						// skip inaccessible directories
					}
				}
			}
		}

		await walkDirectory(root, '', 0);
		return entries;
	} catch (error) {
		console.error('Error listing file tree:', error);
		return [];
	}
}

export async function fileExists(filename: string): Promise<boolean> {
	const handle = await getHandle(filename, false);
	return handle !== undefined;
}

export interface FileMetadata {
	size: number;
	lastModified: number;
	type: string;
}

export async function getFileMetadata(filename: string): Promise<FileMetadata | undefined> {
	const fileHandle = await getHandle(filename);
	if (!fileHandle) return undefined;

	const file = await fileHandle.getFile();
	return {
		size: file.size,
		lastModified: file.lastModified,
		type: file.type
	};
}

export async function deleteFile(filename: string): Promise<boolean> {
	try {
		const root = await navigator.storage.getDirectory();
		const parts = filename.split('/');
		const name = parts.pop()!;

		let dir: FileSystemDirectoryHandle = root;
		for (const part of parts) {
			dir = await dir.getDirectoryHandle(part);
		}

		await dir.removeEntry(name, { recursive: false });
		return true;
	} catch (error) {
		console.error('Error deleting file:', error);
		return false;
	}
}

export async function deleteFiles(
	filenames: string[]
): Promise<{ deleted: number; failed: number }> {
	let deleted = 0;
	let failed = 0;

	for (const filename of filenames) {
		const success = await deleteFile(filename);
		if (success) {
			deleted++;
		} else {
			failed++;
		}
	}

	return { deleted, failed };
}

export async function saveBinaryFile(filename: string, data: Uint8Array): Promise<void> {
	const stream = await openWrite(filename);
	await stream?.write(data.buffer as ArrayBuffer);
	await stream?.close();
}

export async function readBinaryFile(filename: string): Promise<Uint8Array | undefined> {
	const fileHandle = await getHandle(filename);
	if (!fileHandle) {
		console.warn('File could not be opened', filename);
		return undefined;
	}
	const file = await fileHandle.getFile();
	const buffer = await file.arrayBuffer();
	return new Uint8Array(buffer as ArrayBuffer);
}

export async function deleteAll(): Promise<void> {
	const root = await navigator.storage.getDirectory();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for await (const [name, handle] of (root as any).entries()) {
		if (handle.kind === 'directory') {
			await root.removeEntry(name, { recursive: true });
		} else {
			await root.removeEntry(name);
		}
	}
}
