// Files received through the Web Share Target (see `share_target` in static/manifest.webmanifest).
// The service worker stores them in the Cache API, the /share-target page reads and clears them.
// This module has no dependencies so it can be imported from both contexts.

export const SHARE_TARGET_PATH = '/share-target';
export const SHARED_FILES_CACHE = 'shared-files-v1';
/** Name of the multipart field declared in the manifest. */
export const SHARE_FIELD = 'pdf';

/**
 * Reject shares whose multipart body exceeds this. Content-Length covers all files plus
 * overhead; statement PDFs are a few MB at most, so 25 MB is generous headroom while still
 * protecting the Cache API quota on mobile.
 */
export const MAX_SHARED_BYTES = 25 * 1024 * 1024;

const STORE_LOCK = 'shared-files-store';

/**
 * Serializes access to SHARED_FILES_CACHE across the service worker and page realms — both
 * import this module, so a module-level promise would not be shared between them. Falls back
 * to no locking where LockManager is unavailable.
 */
async function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
	if (navigator.locks) return navigator.locks.request(STORE_LOCK, fn);
	return fn();
}

const FILE_NAME_HEADER = 'X-File-Name';

export type SharedFile = { name: string; type: string; size: number; blob: Blob };

const keyFor = (index: number) => `${SHARE_TARGET_PATH}/files/${index}`;

/** Replaces any previously shared files with the given ones. */
export async function storeSharedFiles(files: File[]): Promise<void> {
	await withStoreLock(async () => {
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
	});
}

export async function readSharedFiles(): Promise<SharedFile[]> {
	return withStoreLock(async () => {
		if (!(await caches.has(SHARED_FILES_CACHE))) return [];
		const cache = await caches.open(SHARED_FILES_CACHE);
		const requests = await cache.keys();
		const result: SharedFile[] = [];
		for (const request of requests) {
			const response = await cache.match(request);
			if (!response) continue;
			const blob = await response.blob();
			const encodedName = response.headers.get(FILE_NAME_HEADER);
			let name = 'shared-file';
			if (encodedName) {
				try {
					name = decodeURIComponent(encodedName);
				} catch {
					// Malformed escape sequence: keep the default name instead of failing the whole read.
				}
			}
			result.push({ name, type: blob.type, size: blob.size, blob });
		}
		return result;
	});
}

export async function clearSharedFiles(): Promise<void> {
	await withStoreLock(() => caches.delete(SHARED_FILES_CACHE));
}

/** The platform may label PDFs as application/octet-stream, so check the extension too. */
export function isPdf(file: { name: string; type: string }): boolean {
	return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}
