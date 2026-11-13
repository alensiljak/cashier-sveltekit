/*
	Pure decisions behind the "import ledger" page (/opfs/import-ledger): how a scanned source
	file compares to what was imported before, which files a sync copies or deletes, and how the
	import manifest is reconciled with what is actually in OPFS. No I/O, so it is unit-testable.
*/
import { matchesAny } from './fsScan';
import type { ImportedFileMeta } from './importManifest';

export type FileStatus = 'new' | 'modified' | 'identical' | 'deleted';

export type ScannedFile = {
	path: string;
	size: number;
	lastModified: number;
	getFile?: () => Promise<File>;
	status: FileStatus;
};

export type ImportMode = 'all' | 'modified';

export type ScanStats = Record<FileStatus, number>;

/** Status of a source file against the manifest entry of its last import (size and mtime). */
export function classifyFile(
	prev: Pick<ImportedFileMeta, 'size' | 'lastModified'> | undefined,
	file: { size: number; lastModified: number }
): Exclude<FileStatus, 'deleted'> {
	if (!prev) return 'new';
	return prev.size === file.size && prev.lastModified === file.lastModified
		? 'identical'
		: 'modified';
}

/** Manifest entries whose source file is gone, as `deleted` rows. */
export function findDeleted(
	manifest: Map<string, Pick<ImportedFileMeta, 'size' | 'lastModified'>>,
	seen: Set<string>
): ScannedFile[] {
	const deleted: ScannedFile[] = [];
	for (const [path, meta] of manifest) {
		if (!seen.has(path)) {
			deleted.push({
				path,
				size: meta.size,
				lastModified: meta.lastModified,
				status: 'deleted'
			});
		}
	}
	return deleted;
}

export function countStatuses(files: Pick<ScannedFile, 'status'>[]): ScanStats {
	const stats: ScanStats = { new: 0, modified: 0, identical: 0, deleted: 0 };
	for (const f of files) stats[f.status]++;
	return stats;
}

/** Files a sync writes to OPFS: only changed ones, or every file still in the source. */
export function filesToCopy(files: ScannedFile[], mode: ImportMode): ScannedFile[] {
	return mode === 'modified'
		? files.filter((f) => f.status === 'new' || f.status === 'modified')
		: files.filter((f) => f.status !== 'deleted');
}

export function filesToDelete(files: ScannedFile[]): ScannedFile[] {
	return files.filter((f) => f.status === 'deleted');
}

/** How many files the next sync will touch (copies only, as deletions are always applied). */
export function importCount(files: ScannedFile[], mode: ImportMode): number {
	return mode === 'modified' ? files.filter((f) => f.status !== 'identical').length : files.length;
}

/** Line endings are ignored when comparing the source with what is in OPFS. */
export const normalizeLineEndings = (s: string) => s.replace(/\r\n/g, '\n');

/** An OPFS tree entry, as listed by `listFileTree`. */
export interface TreeFile {
	kind: string;
	path: string;
	name: string;
	size?: number;
	lastModified?: number;
}

/**
 * Reconciles the manifest with what is in OPFS now: entries to add or update for files that exist
 * (keeping `importedAt` for those already known), and paths to drop for files that do not.
 * Files under `excludePrefix` (Cashier-internal data) and files not matching `patterns` are skipped.
 */
export function planManifestRebuild(
	manifest: Map<string, ImportedFileMeta>,
	tree: TreeFile[],
	patterns: RegExp[],
	excludePrefix: string,
	now: number
): { upserts: ImportedFileMeta[]; stale: string[] } {
	const actualPaths = new Set<string>();
	const upserts: ImportedFileMeta[] = [];

	for (const entry of tree) {
		if (entry.kind !== 'file') continue;
		if (entry.path.startsWith(excludePrefix)) continue;
		if (patterns.length > 0 && !matchesAny(entry.name, patterns)) continue;
		if (entry.size === undefined || entry.lastModified === undefined) continue;

		actualPaths.add(entry.path);
		const prev = manifest.get(entry.path);
		if (prev && prev.size === entry.size && prev.lastModified === entry.lastModified) {
			continue; // unchanged, no need to rewrite
		}
		upserts.push({
			path: entry.path,
			size: entry.size,
			lastModified: entry.lastModified,
			importedAt: prev?.importedAt ?? now
		});
	}

	return { upserts, stale: [...manifest.keys()].filter((path) => !actualPaths.has(path)) };
}
