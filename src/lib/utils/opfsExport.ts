/**
 * Utilities for exporting the OPFS ledger directory tree — the opposite
 * direction of `fsScan.ts` / import-ledger. Cashier is the source of truth
 * here; the user is dumping the whole OPFS structure onto a local filesystem
 * (native directory, where supported) or into a downloadable ZIP archive
 * (browsers without the File System Access API, e.g. Firefox).
 *
 * Two root-level entries are always excluded:
 *  - `CASHIER_DATA_DIR` (`.cashier/`) — Cashier's internal cache & hash, not source data.
 *  - `CASHIER_XACT_FILE` (`cashier.bean`) — the on-device transaction store, which
 *    is app-local for now and not part of the exported book.
 */
import { CASHIER_DATA_DIR, CASHIER_XACT_FILE } from '$lib/constants';
import { createZipArchive } from '$lib/utils/zip';

const EXCLUDED_ROOT_ENTRIES: Record<string, true> = {
	[CASHIER_DATA_DIR]: true,
	[CASHIER_XACT_FILE]: true
};

export interface ExportFileEntry {
	path: string;
	handle: FileSystemFileHandle;
	size: number;
}

/**
 * Recursively collects every exportable file in OPFS, skipping the excluded
 * root-level entries. Returned entries are sorted by path for a stable preview.
 */
export async function collectExportableFiles(): Promise<ExportFileEntry[]> {
	const root = await navigator.storage.getDirectory();
	const results: ExportFileEntry[] = [];

	async function walk(dir: FileSystemDirectoryHandle, prefix: string, depth: number) {
		for await (const [name, handle] of dir.entries()) {
			if (depth === 0 && EXCLUDED_ROOT_ENTRIES[name]) continue;
			const path = prefix ? `${prefix}/${name}` : name;
			if (handle.kind === 'directory') {
				await walk(handle as FileSystemDirectoryHandle, path, depth + 1);
			} else {
				const fileHandle = handle as FileSystemFileHandle;
				const file = await fileHandle.getFile();
				results.push({ path, handle: fileHandle, size: file.size });
			}
		}
	}

	await walk(root, '', 0);
	results.sort((a, b) => a.path.localeCompare(b.path));
	return results;
}

/** Writes one file into a destination directory handle, creating subdirectories as needed. */
async function writeIntoDirectory(
	destRoot: FileSystemDirectoryHandle,
	path: string,
	file: File
): Promise<void> {
	const parts = path.split('/');
	const name = parts.pop()!;
	let dir = destRoot;
	for (const part of parts) {
		dir = await dir.getDirectoryHandle(part, { create: true });
	}
	const fileHandle = await dir.getFileHandle(name, { create: true });
	const writable = await fileHandle.createWritable();
	await writable.write(file);
	await writable.close();
}

/**
 * Copies every given OPFS file entry into `destRoot`, preserving relative paths.
 * Existing files at matching paths are overwritten; nothing else in `destRoot`
 * is touched or removed — this is a one-way dump, not a mirroring sync.
 */
export async function exportEntriesToDirectory(
	destRoot: FileSystemDirectoryHandle,
	entries: ExportFileEntry[],
	onProgress?: (done: number, total: number, path: string) => void
): Promise<void> {
	let done = 0;
	for (const entry of entries) {
		const file = await entry.handle.getFile();
		await writeIntoDirectory(destRoot, entry.path, file);
		done++;
		onProgress?.(done, entries.length, entry.path);
	}
}

/** Reads every given OPFS file entry into memory as a flat path → bytes map. */
async function readEntriesForZip(
	entries: ExportFileEntry[],
	onProgress?: (done: number, total: number, path: string) => void
): Promise<Record<string, Uint8Array>> {
	const data: Record<string, Uint8Array> = {};
	let done = 0;
	for (const entry of entries) {
		const file = await entry.handle.getFile();
		data[entry.path] = new Uint8Array(await file.arrayBuffer());
		done++;
		onProgress?.(done, entries.length, entry.path);
	}
	return data;
}

/**
 * Reads every given OPFS file entry and packs it into a single ZIP archive,
 * for browsers without File System Access API support (e.g. Firefox).
 */
export async function exportEntriesToZip(
	entries: ExportFileEntry[],
	onProgress?: (done: number, total: number, path: string) => void
): Promise<Uint8Array<ArrayBuffer>> {
	const data = await readEntriesForZip(entries, onProgress);
	return createZipArchive(data);
}
