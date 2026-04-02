import { settings, SettingKeys } from '$lib/settings';
import type { StorageBackend, StorageBackendType } from './storageBackend';
import { OPFSBackend } from './opfsBackend';
import { FileSystemAccessBackend } from './fileSystemAccessBackend';
import { IndexedDBBackend } from './indexedDbBackend';

export type { StorageBackend, StorageBackendType };
export { OPFSBackend, FileSystemAccessBackend, IndexedDBBackend };

let cachedBackend: StorageBackend | null = null;
let cachedType: StorageBackendType | null = null;

// Singleton for the FS backend so the directory handle is preserved
const fsBackendInstance = new FileSystemAccessBackend();

/**
 * Returns the FileSystemAccessBackend singleton.
 * Useful when the UI needs to call pickDirectory() or check handle state.
 */
export function getFileSystemBackend(): FileSystemAccessBackend {
	return fsBackendInstance;
}

/**
 * Creates a storage backend instance for the given type.
 */
function createBackend(type: StorageBackendType): StorageBackend {
	switch (type) {
		case 'opfs':
			return new OPFSBackend();
		case 'filesystem':
			return fsBackendInstance;
		case 'indexeddb':
			return new IndexedDBBackend();
		default:
			return new OPFSBackend();
	}
}

/**
 * Returns the currently-configured storage backend.
 * Reads the setting from IndexedDB and caches the instance.
 */
export async function getStorageBackend(): Promise<StorageBackend> {
	const type = await settings.get<StorageBackendType>(SettingKeys.storageBackend);
	const resolved = type ?? 'opfs';

	if (cachedBackend && cachedType === resolved) {
		return cachedBackend;
	}

	cachedBackend = createBackend(resolved);
	cachedType = resolved;
	return cachedBackend;
}

/**
 * Clears the cached backend so the next call to getStorageBackend()
 * re-reads the setting. Call this after changing the storage backend setting.
 */
export function invalidateStorageBackendCache(): void {
	cachedBackend = null;
	cachedType = null;
}
