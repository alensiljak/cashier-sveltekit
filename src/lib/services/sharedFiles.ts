// Files received through the Web Share Target (see `share_target` in static/manifest.webmanifest).
// The service worker stores them in the Cache API, the /share-target page reads and clears them.
// This module has no dependencies so it can be imported from both contexts.

export const SHARE_TARGET_PATH = '/share-target';
export const SHARED_FILES_CACHE = 'shared-files-v1';
/** Name of the multipart field declared in the manifest. */
export const SHARE_FIELD = 'pdf';

const FILE_NAME_HEADER = 'X-File-Name';

export type SharedFile = { name: string; type: string; size: number; blob: Blob };

const keyFor = (index: number) => `${SHARE_TARGET_PATH}/files/${index}`;

/** Replaces any previously shared files with the given ones. */
export async function storeSharedFiles(files: File[]): Promise<void> {
	await caches.delete(SHARED_FILES_CACHE);
	const cache = await caches.open(SHARED_FILES_CACHE);
	await Promise.all(
		files.map((file, index) =>
			cache.put(
				keyFor(index),
				new Response(file, {
					headers: {
						'Content-Type': file.type || 'application/octet-stream',
						[FILE_NAME_HEADER]: encodeURIComponent(file.name)
					}
				})
			)
		)
	);
}

export async function readSharedFiles(): Promise<SharedFile[]> {
	if (!(await caches.has(SHARED_FILES_CACHE))) return [];
	const cache = await caches.open(SHARED_FILES_CACHE);
	const requests = await cache.keys();
	const result: SharedFile[] = [];
	for (const request of requests) {
		const response = await cache.match(request);
		if (!response) continue;
		const blob = await response.blob();
		const encodedName = response.headers.get(FILE_NAME_HEADER);
		result.push({
			name: encodedName ? decodeURIComponent(encodedName) : 'shared-file',
			type: blob.type,
			size: blob.size,
			blob
		});
	}
	return result;
}

export async function clearSharedFiles(): Promise<void> {
	await caches.delete(SHARED_FILES_CACHE);
}

/** The platform may label PDFs as application/octet-stream, so check the extension too. */
export function isPdf(file: { name: string; type: string }): boolean {
	return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}
