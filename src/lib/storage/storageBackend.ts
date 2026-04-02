/**
 * Unified storage backend interface.
 * All backends must implement these methods to be used as the active storage.
 */
export interface StorageBackend {
	readFile(filename: string): Promise<string | undefined>;
	writeFile(filename: string, content: string): Promise<void>;
	listFiles(): Promise<string[]>;
	lastModified(filename: string): Promise<number | undefined>;
}

export type StorageBackendType = 'opfs' | 'filesystem' | 'indexeddb';
