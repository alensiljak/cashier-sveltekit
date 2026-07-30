/**
 * Persistence of File System Access API directory handles in IndexedDB.
 * Handles are stored by caller-supplied key so multiple pages can keep
 * independent directory selections.
 */

import db from '$lib/data/db';

export async function persistHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
	await db.fsHandles.put(handle, key);
}

export async function loadPersistedHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
	try {
		const result = await db.fsHandles.get(key);
		return result ?? null;
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

export async function requestWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
	try {
		const permission = await (
			handle as unknown as {
				requestPermission: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
			}
		).requestPermission({ mode: 'readwrite' });
		return permission === 'granted';
	} catch {
		return false;
	}
}
