/**
 * IndexedDB-backed manifest of files imported from an external directory into
 * OPFS. Stores size + lastModified per imported path so subsequent scans can
 * detect new, modified, or deleted files without hashing content.
 */

export type ImportedFileMeta = {
	path: string;
	size: number;
	lastModified: number;
	importedAt: number;
};

const DB_NAME = 'cashier-import-manifest';
const STORE = 'files';

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(STORE, { keyPath: 'path' });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export async function getManifest(): Promise<Map<string, ImportedFileMeta>> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readonly');
		const req = tx.objectStore(STORE).getAll();
		req.onsuccess = () => {
			db.close();
			const map = new Map<string, ImportedFileMeta>();
			for (const entry of req.result as ImportedFileMeta[]) {
				map.set(entry.path, entry);
			}
			resolve(map);
		};
		req.onerror = () => {
			db.close();
			reject(req.error);
		};
	});
}

/**
 * The manifest limited to files that are still in OPFS. Files can be removed without going through
 * the import (OPFS page, peer sync, etc.), so entries for missing files are dropped here; otherwise
 * a scan would report their unchanged sources as identical and never copy them again.
 */
export async function getReconciledManifest(
	opfsPaths: Iterable<string>
): Promise<Map<string, ImportedFileMeta>> {
	const manifest = await getManifest();
	const existing = new Set(opfsPaths);
	const stale = [...manifest.keys()].filter((path) => !existing.has(path));
	await deleteManifestEntries(stale);
	for (const path of stale) manifest.delete(path);
	return manifest;
}

export async function putManifestEntry(meta: ImportedFileMeta): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).put(meta);
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
	});
}

export async function putManifestEntries(entries: ImportedFileMeta[]): Promise<void> {
	if (entries.length === 0) return;
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		for (const entry of entries) {
			store.put(entry);
		}
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
	});
}

export async function deleteManifestEntries(paths: string[]): Promise<void> {
	if (paths.length === 0) return;
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		for (const path of paths) {
			store.delete(path);
		}
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
	});
}

export async function deleteManifestEntry(path: string): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).delete(path);
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
	});
}
