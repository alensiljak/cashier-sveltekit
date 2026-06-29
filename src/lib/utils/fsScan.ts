/**
 * Glob-based file collection from a File System Access API directory handle.
 */

export function globToRegex(pattern: string): RegExp {
	const escaped = pattern
		.trim()
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '.*')
		.replace(/\?/g, '.');
	return new RegExp(`^${escaped}$`, 'i');
}

export function parseSpecs(raw: string): RegExp[] {
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map(globToRegex);
}

export function matchesAny(name: string, patterns: RegExp[]): boolean {
	return patterns.some((p) => p.test(name));
}

/**
 * Traverses a File System Access API directory tree and invokes onFile for each
 * matching file as it is discovered, allowing callers to pipeline work (e.g.
 * getFile() calls) concurrently with the ongoing traversal.
 */
export async function collectFsFileHandles(
	dir: FileSystemDirectoryHandle,
	prefix: string,
	patterns: RegExp[],
	onFile: (path: string, handle: FileSystemFileHandle) => void
): Promise<void> {
	const subdirPromises: Promise<void>[] = [];
	for await (const [name, handle] of dir.entries()) {
		const path = prefix ? `${prefix}/${name}` : name;
		if (handle.kind === 'file' && matchesAny(name, patterns)) {
			onFile(path, handle as FileSystemFileHandle);
		} else if (handle.kind === 'directory' && !name.startsWith('.')) {
			subdirPromises.push(
				collectFsFileHandles(handle as FileSystemDirectoryHandle, path, patterns, onFile)
			);
		}
	}
	await Promise.all(subdirPromises);
}
