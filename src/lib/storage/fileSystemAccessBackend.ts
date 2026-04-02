import type { StorageBackend } from './storageBackend';

const IDB_NAME = 'cashier-fs-handles';
const IDB_STORE = 'handles';
const HANDLE_KEY = 'directoryHandle';

/**
 * Storage backend using the File System Access API (showDirectoryPicker).
 * The directory handle is persisted in IndexedDB so it survives across sessions.
 * The user may need to re-grant permission on the next visit.
 */
export class FileSystemAccessBackend implements StorageBackend {
	private dirHandle: FileSystemDirectoryHandle | null = null;

	async readFile(filename: string): Promise<string | undefined> {
		const dir = await this.getDirectoryHandle();
		if (!dir) return undefined;

		try {
			const fileHandle = await dir.getFileHandle(filename);
			const file = await fileHandle.getFile();
			return file.text();
		} catch (error: any) {
			if (error.name === 'NotFoundError') return undefined;
			throw error;
		}
	}

	async writeFile(filename: string, content: string): Promise<void> {
		const dir = await this.getDirectoryHandle();
		if (!dir) throw new Error('No directory selected. Call pickDirectory() first.');

		const fileHandle = await dir.getFileHandle(filename, { create: true });
		const stream = await fileHandle.createWritable();
		await stream.write(new TextEncoder().encode(content));
		await stream.close();
	}

	async listFiles(): Promise<string[]> {
		const dir = await this.getDirectoryHandle();
		if (!dir) return [];

		const files: string[] = [];
		for await (const [name, handle] of (dir as any).entries()) {
			if (handle.kind === 'file') {
				files.push(name);
			}
		}
		return files;
	}

	async lastModified(filename: string): Promise<number | undefined> {
		const dir = await this.getDirectoryHandle();
		if (!dir) return undefined;

		try {
			const fileHandle = await dir.getFileHandle(filename);
			const file = await fileHandle.getFile();
			return file.lastModified;
		} catch (error: any) {
			if (error.name === 'NotFoundError') return undefined;
			throw error;
		}
	}

	/**
	 * Prompt the user to select a directory via showDirectoryPicker().
	 * Stores the handle in IndexedDB for persistence across sessions.
	 */
	async pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
		try {
			this.dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
			if (this.dirHandle) {
				await this.persistHandle(this.dirHandle);
			}
			return this.dirHandle;
		} catch (error: any) {
			if (error.name === 'AbortError') return null;
			throw error;
		}
	}

	/**
	 * Get the current directory handle, restoring from IndexedDB if needed.
	 * Re-requests permission if the handle was persisted from a previous session.
	 */
	async getDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
		if (this.dirHandle) return this.dirHandle;

		// Try to restore from IndexedDB
		const stored = await this.loadHandle();
		if (!stored) return null;

		// Verify we still have permission (may prompt user)
		const permission = await (stored as any).requestPermission({ mode: 'readwrite' });
		if (permission === 'granted') {
			this.dirHandle = stored;
			return stored;
		}

		return null;
	}

	/**
	 * Returns the name of the currently-selected directory, or null.
	 */
	async getDirectoryName(): Promise<string | null> {
		const dir = await this.getDirectoryHandle();
		return dir?.name ?? null;
	}

	/** Check if a directory handle is persisted (without requesting permission). */
	async hasPersistedHandle(): Promise<boolean> {
		const handle = await this.loadHandle();
		return handle !== null;
	}

	// --- IndexedDB persistence for the directory handle ---

	private openIdb(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const req = indexedDB.open(IDB_NAME, 1);
			req.onupgradeneeded = () => {
				req.result.createObjectStore(IDB_STORE);
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	private async persistHandle(handle: FileSystemDirectoryHandle): Promise<void> {
		const db = await this.openIdb();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(IDB_STORE, 'readwrite');
			tx.objectStore(IDB_STORE).put(handle, HANDLE_KEY);
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

	private async loadHandle(): Promise<FileSystemDirectoryHandle | null> {
		try {
			const db = await this.openIdb();
			return new Promise((resolve, reject) => {
				const tx = db.transaction(IDB_STORE, 'readonly');
				const req = tx.objectStore(IDB_STORE).get(HANDLE_KEY);
				req.onsuccess = () => {
					db.close();
					resolve(req.result ?? null);
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
}
