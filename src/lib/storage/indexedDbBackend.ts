import type { StorageBackend } from './storageBackend';

/**
 * Storage backend shim using IndexedDB for file-like storage.
 * Placeholder for future implementation — serves as an alternative backend
 * using the data store that was primary before the engine migration.
 */
export class IndexedDBBackend implements StorageBackend {
	async readFile(_filename: string): Promise<string | undefined> {
		throw new Error('IndexedDBBackend is not yet implemented');
	}

	async writeFile(_filename: string, _content: string): Promise<void> {
		throw new Error('IndexedDBBackend is not yet implemented');
	}

	async listFiles(): Promise<string[]> {
		throw new Error('IndexedDBBackend is not yet implemented');
	}

	async lastModified(_filename: string): Promise<number | undefined> {
		throw new Error('IndexedDBBackend is not yet implemented');
	}
}
