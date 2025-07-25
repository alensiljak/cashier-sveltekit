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
