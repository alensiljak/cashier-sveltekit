/*
	Pure decisions about files copied between a source folder and OPFS, used by the "import ledger"
	and OPFS sync pages: how each file compares on both sides, and which files an import copies or
	deletes. File access is passed in, so it is unit-testable.

	OPFS can change without an import (edits in the app, peer sync), so both sides are compared:
	the source against the manifest entry of the last import, and OPFS against its `importedAt`.
	Times are only a hint, so contents decide whether there is a difference at all.
*/
import type { ImportedFileMeta } from './importManifest';

/** `local`: only the OPFS copy changed. `conflict`: both sides did, or there is no history. */
export type FileStatus = 'new' | 'modified' | 'local' | 'conflict' | 'identical' | 'deleted';

export type ScannedFile = {
	path: string;
	size: number;
	lastModified: number;
	getFile?: () => Promise<File>;
	status: FileStatus;
	/** The source file is gone; applying this row deletes the OPFS file. */
	sourceMissing?: boolean;
	/** The user chose to replace (or delete) an OPFS file with changes of its own. */
	overwrite?: boolean;
};

export type ImportMode = 'all' | 'modified';

export type ScanStats = Record<FileStatus, number>;

/** What is known of an OPFS file; the time may be unavailable. */
export type OpfsFileInfo = { lastModified?: number };

/** Rows that would lose changes made in OPFS, so they are applied only when asked for. */
export const hasLocalChanges = (f: Pick<ScannedFile, 'status'>) =>
	f.status === 'local' || f.status === 'conflict';

/** An unknown modification time counts as changed, so the contents get compared. */
function changedSinceImport(opfs: OpfsFileInfo, meta: Pick<ImportedFileMeta, 'importedAt'>) {
	return opfs.lastModified === undefined || opfs.lastModified > meta.importedAt;
}

/** Ignores the differences OPFS writes introduce: line endings and the final newline. */
export function isSameContent(a: string, b: string): boolean {
	const canonical = (s: string) => {
		const lf = s.replace(/\r\n?/g, '\n');
		return lf === '' || lf.endsWith('\n') ? lf : `${lf}\n`;
	};
	return canonical(a) === canonical(b);
}

/**
 * Status of a source file. `record` means both sides turned out to hold the same content after
 * one of them changed, so the manifest entry should be refreshed. `readBoth` is only called
 * when the times cannot tell.
 */
export async function classifyFile(
	source: { size: number; lastModified: number },
	meta: ImportedFileMeta | undefined,
	opfs: OpfsFileInfo | undefined,
	readBoth: () => Promise<[source: string, opfs: string]>
): Promise<{ status: Exclude<FileStatus, 'deleted'>; record: boolean }> {
	if (!opfs) return { status: 'new', record: false };

	const sourceChanged =
		!meta || meta.size !== source.size || meta.lastModified !== source.lastModified;
	const opfsChanged = !meta || changedSinceImport(opfs, meta);
	if (!sourceChanged && !opfsChanged) return { status: 'identical', record: false };

	if (isSameContent(...(await readBoth()))) return { status: 'identical', record: true };

	if (sourceChanged && opfsChanged) return { status: 'conflict', record: false };
	return { status: sourceChanged ? 'modified' : 'local', record: false };
}

/**
 * Rows for manifest entries whose source file is gone: `deleted`, or `conflict` when the OPFS
 * file has changed since the import.
 */
export function findDeleted(
	manifest: Map<string, ImportedFileMeta>,
	seen: Set<string>,
	opfsFiles: Map<string, OpfsFileInfo>
): ScannedFile[] {
	const deleted: ScannedFile[] = [];
	for (const [path, meta] of manifest) {
		if (!seen.has(path)) {
			const opfs = opfsFiles.get(path);
			deleted.push({
				path,
				size: meta.size,
				lastModified: meta.lastModified,
				status: opfs && changedSinceImport(opfs, meta) ? 'conflict' : 'deleted',
				sourceMissing: true
			});
		}
	}
	return deleted;
}

export function countStatuses(files: Pick<ScannedFile, 'status'>[]): ScanStats {
	const stats: ScanStats = {
		new: 0,
		modified: 0,
		local: 0,
		conflict: 0,
		identical: 0,
		deleted: 0
	};
	for (const f of files) stats[f.status]++;
	return stats;
}

/**
 * Files an import writes to OPFS: the source changes plus the overwrites asked for, or, in
 * "all" mode, every file still in the source.
 */
export function filesToCopy(files: ScannedFile[], mode: ImportMode): ScannedFile[] {
	return files.filter(
		(f) =>
			!f.sourceMissing &&
			(mode === 'all' ||
				f.status === 'new' ||
				f.status === 'modified' ||
				(hasLocalChanges(f) && !!f.overwrite))
	);
}

export function filesToDelete(files: ScannedFile[]): ScannedFile[] {
	return files.filter((f) => f.sourceMissing && (f.status === 'deleted' || !!f.overwrite));
}

/** How many files the next import will touch. */
export function importCount(files: ScannedFile[], mode: ImportMode): number {
	return filesToCopy(files, mode).length + filesToDelete(files).length;
}
