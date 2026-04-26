/**
 * Persistence of File System Access API directory handles in IndexedDB.
 * Handles are stored by caller-supplied key so multiple pages can keep
 * independent directory selections.
 */

const DB_NAME = 'cashier-fs-handles';
const STORE = 'handles';

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export async function persistHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).put(handle, key);
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

export async function loadPersistedHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
	try {
		const db = await openDb();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readonly');
			const req = tx.objectStore(STORE).get(key);
			req.onsuccess = () => {
				db.close();
				resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
			};
			req.onerror = () => {
				db.close();
				reject(req.error);
			};
		});
	} catch {
		return null;
	}
}

export async function requestReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
	try {
		const permission = await (
			handle as unknown as {
				requestPermission: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
			}
		).requestPermission({ mode: 'read' });
		return permission === 'granted';
	} catch {
		return false;
	}
}
