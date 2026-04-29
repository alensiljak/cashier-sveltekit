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

export async function collectFsFileHandles(
	dir: FileSystemDirectoryHandle,
	prefix: string,
	patterns: RegExp[],
	out: Array<{ path: string; handle: FileSystemFileHandle }>
): Promise<void> {
	// @ts-expect-error entries() is available in modern browsers
	for await (const [name, handle] of dir.entries()) {
		const path = prefix ? `${prefix}/${name}` : name;
		if (handle.kind === 'file' && matchesAny(name, patterns)) {
			out.push({ path, handle: handle as FileSystemFileHandle });
		} else if (handle.kind === 'directory' && !name.startsWith('.')) {
			await collectFsFileHandles(handle as FileSystemDirectoryHandle, path, patterns, out);
		}
	}
}
