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
		const fileHandle = await root.getFileHandle(filename, {
			create: create
		});

		return fileHandle;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (error: any) {
		if (error.name === 'NotFoundError') {
			console.log('The file does not exist');
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
		// @ts-expect-error - FileSystemDirectoryHandle.entries() is part of the File System Access API
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

export async function fileExists(filename: string): Promise<boolean> {
	const handle = await getHandle(filename, false);
	return handle !== undefined;
}

export async function deleteFile(filename: string): Promise<boolean> {
	try {
		const root = await navigator.storage.getDirectory();
		await root.removeEntry(filename, { recursive: false });
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
