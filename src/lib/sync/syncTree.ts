/*
	Pure view-model helpers for the Beancount sync page: unions the local and
	remote scans into aligned file rows, nests them into a folder tree, counts
	the outcomes and phrases the preview banner. No Svelte, no I/O, so all of it
	is unit-testable. State and side effects live in beancountSyncController.svelte.ts.
*/
import type { SyncEntry } from './SyncSource';
import type { DiffEntry, SyncAction, SyncStatus } from './syncDiff';

export interface TreeRow {
	path: string;
	name: string;
	kind: 'file' | 'directory';
	depth: number;
	expanded: boolean;
	local?: SyncEntry;
	remote?: SyncEntry;
	status?: SyncStatus;
	/** User override if set, else the diff's default action. Undefined when no diff is available yet. */
	effectiveAction?: SyncAction;
	/** Directories only: count of conflicted files anywhere in this subtree, shown even while collapsed. */
	conflictCount?: number;
	/** Directories only: count of files anywhere in this subtree with any diff status, shown even while collapsed. */
	diffCount?: number;
}

function parentOf(path: string): string {
	return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

function depthOf(parent: string): number {
	return parent ? parent.split('/').length : 0;
}

/**
 * One row per file path found on either side, independent of any folder
 * expand state — apply logic must always see every file.
 */
export function buildFileRows(
	localList: SyncEntry[],
	remoteList: SyncEntry[],
	diffs: Map<string, DiffEntry>,
	userOverrides: Map<string, SyncAction>
): TreeRow[] {
	const byPath = new Map<string, { local?: SyncEntry; remote?: SyncEntry }>();
	for (const e of localList) byPath.set(e.path, { ...byPath.get(e.path), local: e });
	for (const e of remoteList) byPath.set(e.path, { ...byPath.get(e.path), remote: e });

	const rows: TreeRow[] = [];
	for (const [path, { local, remote }] of byPath) {
		const diff = diffs.get(path);
		rows.push({
			path,
			name: path.split('/').pop()!,
			kind: 'file',
			depth: depthOf(parentOf(path)),
			expanded: false,
			local,
			remote,
			status: diff?.status,
			effectiveAction: diff ? (userOverrides.get(path) ?? diff.action) : undefined
		});
	}
	return rows;
}

/**
 * Nests file rows under their directories and returns the visible rows
 * (descent stops at collapsed directories), so this is for rendering only.
 * When `diffsOnly` is set, unchanged files and diff-free directories are
 * dropped and any directory with a differing descendant is forced open —
 * otherwise its diffs would stay hidden behind a folder the user had no reason
 * to expand.
 */
export function buildTree(
	fileRows: TreeRow[],
	expandedPaths: Set<string>,
	diffsOnly: boolean
): TreeRow[] {
	const childrenOf = new Map<string, TreeRow[]>();
	const addChild = (parent: string, row: TreeRow) => {
		const list = childrenOf.get(parent);
		if (list) list.push(row);
		else childrenOf.set(parent, [row]);
	};

	const dirPaths = new Set<string>();
	for (const { path } of fileRows) {
		const parts = path.split('/');
		for (let i = 1; i < parts.length; i++) dirPaths.add(parts.slice(0, i).join('/'));
	}
	const dirRowByPath = new Map<string, TreeRow>();
	for (const dirPath of dirPaths) {
		const parent = parentOf(dirPath);
		const dirRow: TreeRow = {
			path: dirPath,
			name: dirPath.split('/').pop()!,
			kind: 'directory',
			depth: depthOf(parent),
			expanded: expandedPaths.has(dirPath),
			conflictCount: 0,
			diffCount: 0
		};
		dirRowByPath.set(dirPath, dirRow);
		addChild(parent, dirRow);
	}

	for (const fileRow of fileRows) {
		addChild(parentOf(fileRow.path), fileRow);
		if (fileRow.status && fileRow.status !== 'unchanged') {
			const parts = fileRow.path.split('/');
			for (let i = 1; i < parts.length; i++) {
				const dirRow = dirRowByPath.get(parts.slice(0, i).join('/'));
				if (dirRow) {
					dirRow.diffCount!++;
					if (fileRow.status === 'conflict') dirRow.conflictCount!++;
				}
			}
		}
	}

	if (diffsOnly) {
		for (const dirRow of dirRowByPath.values()) {
			if (dirRow.diffCount) dirRow.expanded = true;
		}
	}

	const rows: TreeRow[] = [];
	const walk = (parent: string) => {
		const list = (childrenOf.get(parent) ?? [])
			.filter((row) =>
				!diffsOnly
					? true
					: row.kind === 'directory'
						? !!row.diffCount
						: !!row.status && row.status !== 'unchanged'
			)
			.sort((a, b) =>
				a.kind !== b.kind ? (a.kind === 'directory' ? -1 : 1) : a.name.localeCompare(b.name)
			);
		for (const row of list) {
			rows.push(row);
			if (row.kind === 'directory' && row.expanded) walk(row.path);
		}
	};
	walk('');
	return rows;
}

export interface ActionCounts {
	/** Files that will be pulled, including user-selected ones. */
	pull: number;
	/** Unresolved conflicts (both sides changed since the last sync). */
	conflict: number;
	/** Unresolved "differs" (never synced, contents differ). */
	differs: number;
}

/** Counts by effective action, treating the two unresolved kinds separately. */
export function countActions(fileRows: TreeRow[]): ActionCounts {
	let pull = 0;
	let conflict = 0;
	let differs = 0;
	for (const r of fileRows) {
		if (r.effectiveAction === 'pull') pull++;
		else if (r.effectiveAction === 'conflict') {
			if (r.status === 'conflict') conflict++;
			else if (r.status === 'differs') differs++;
		}
	}
	return { pull, conflict, differs };
}

/**
 * Pull/conflict counts for the peer picker's badges. 'differs' counts as a
 * conflict there, since both need a decision.
 */
export function countPeerDiffs(
	diffs: DiffEntry[],
	overrides: Map<string, SyncAction>
): { pull: number; conflict: number } {
	let pull = 0;
	let conflict = 0;
	for (const d of diffs) {
		const action = overrides.get(d.path) ?? d.action;
		if (action === 'pull') pull++;
		else if (action === 'conflict') conflict++;
	}
	return { pull, conflict };
}

/** Explains, in the preview modal, exactly what applying the row's current selection will do. */
export function previewBanner(row: TreeRow | null): { text: string; alertClass: string } | null {
	if (!row) return null;
	if (row.effectiveAction === 'pull') {
		if (!row.remote)
			return {
				text: 'Pull will delete this file locally — removed on remote.',
				alertClass: 'alert-warning'
			};
		if (!row.local)
			return { text: 'Pull will create this file locally.', alertClass: 'alert-info' };
		return {
			text: 'Pull will overwrite the local file with the remote content shown below.',
			alertClass: 'alert-info'
		};
	}
	if (row.effectiveAction === 'skip') {
		return {
			text: 'Skip selected — no changes will be applied to the local file.',
			alertClass: 'alert-success'
		};
	}
	if (row.status === 'differs') {
		return {
			text: 'Never synced with this peer, so there is no way to tell which copy is newer. Review the differences, then pull, merge, or skip. Previewing the Pull outcome.',
			alertClass: 'alert-warning'
		};
	}
	return {
		text: 'Unresolved conflict — previewing the Pull outcome. Choose Skip above to keep the local file unchanged instead.',
		alertClass: 'alert-warning'
	};
}

// ─── Presentation helpers ────────────────────────────────────────────────────

export function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function statusBadgeClass(status: SyncStatus): string {
	switch (status) {
		case 'local-newer':
			return 'badge-info';
		case 'remote-newer':
			return 'badge-success';
		case 'conflict':
			return 'badge-error';
		case 'differs':
			return 'badge-warning';
		default:
			return 'badge-ghost';
	}
}

export function statusDotClass(status: SyncStatus | undefined): string {
	switch (status) {
		case 'local-newer':
			return 'status-info';
		case 'remote-newer':
			return 'status-success';
		case 'conflict':
			return 'status-error';
		case 'differs':
			return 'status-warning';
		default:
			return 'status-neutral';
	}
}

export function statusLabel(status: SyncStatus): string {
	switch (status) {
		case 'local-newer':
			return 'Local newer';
		case 'remote-newer':
			return 'Remote newer';
		case 'conflict':
			return 'Conflict';
		case 'differs':
			return 'Differs';
		default:
			return 'Unchanged';
	}
}

export function metaLine(
	entry: SyncEntry | undefined,
	sideLabel: string,
	missingLabel: string
): string {
	if (!entry) return `${sideLabel}: ${missingLabel}`;
	return `${sideLabel}: ${formatFileSize(entry.size)} · ${new Date(entry.lastModified).toLocaleString()}`;
}
