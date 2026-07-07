/*
	Structural (keyed) diff + merge — the JSON counterpart to diffText.ts's
	line-level diff. A raw line-hunk merge (see DiffViewer.svelte) is safe for
	cashier.bean because Beancount transactions are flat, blank-line-delimited
	blocks: splicing at a line boundary can't corrupt the format. JSON has
	structural constraints a line splice doesn't know about (matching braces,
	no trailing comma on the last array element), so splicing text hunks
	across a JSON document risks producing invalid JSON wherever a hunk
	boundary happens to fall inside the structure. This module instead diffs
	two item arrays by a caller-supplied identity key and reconstructs the
	merge by rebuilding the array (`JSON.stringify`d by the caller), never by
	string splicing. See doc/projects/2026-07-02_beancount-peer-sync.md.
*/

export type KeyedStatus = 'added' | 'removed' | 'changed';

export interface KeyedDiffEntry<T> {
	key: string;
	status: KeyedStatus;
	local?: T;
	remote?: T;
}

/**
 * Structural diff of two item arrays by identity key. A key present on both
 * sides with `equal(local, remote)` true is unchanged and omitted — the
 * keyed equivalent of a line diff's context lines collapsing into the gaps
 * between hunks. Entries are sorted by key for a deterministic, stable
 * render order.
 */
export function diffKeyed<T>(
	local: T[],
	remote: T[],
	keyOf: (item: T) => string,
	equal: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b)
): KeyedDiffEntry<T>[] {
	const localByKey = new Map(local.map((item) => [keyOf(item), item]));
	const remoteByKey = new Map(remote.map((item) => [keyOf(item), item]));
	const keys = new Set([...localByKey.keys(), ...remoteByKey.keys()]);
	const entries: KeyedDiffEntry<T>[] = [];
	for (const key of keys) {
		const l = localByKey.get(key);
		const r = remoteByKey.get(key);
		if (l !== undefined && r !== undefined) {
			if (!equal(l, r)) entries.push({ key, status: 'changed', local: l, remote: r });
		} else if (l !== undefined) {
			entries.push({ key, status: 'removed', local: l });
		} else if (r !== undefined) {
			entries.push({ key, status: 'added', remote: r });
		}
	}
	entries.sort((a, b) => a.key.localeCompare(b.key));
	return entries;
}

/**
 * Reconstructs the merged item list from a keyed diff plus per-entry
 * Theirs/Mine picks. Default (key absent from `rejected`) is Theirs, matching
 * DiffViewer's hunk default. Every key not present in `entries` is unchanged
 * (identical on both sides) and passes through from `local` untouched.
 *
 * "Mine" on a `removed` entry keeps the local item; "Theirs" drops it.
 * "Mine" on an `added` entry excludes the remote-only item; "Theirs" adds it.
 * `changed` picks the local or remote copy outright.
 */
export function resolveKeyedMerge<T>(
	local: T[],
	entries: KeyedDiffEntry<T>[],
	keyOf: (item: T) => string,
	rejected: ReadonlySet<string>
): T[] {
	const changedKeys = new Set(entries.map((e) => e.key));
	const out: T[] = local.filter((item) => !changedKeys.has(keyOf(item)));
	for (const entry of entries) {
		const theirs = !rejected.has(entry.key);
		if (entry.status === 'added') {
			if (theirs) out.push(entry.remote as T);
		} else if (entry.status === 'removed') {
			if (!theirs) out.push(entry.local as T);
		} else {
			out.push((theirs ? entry.remote : entry.local) as T);
		}
	}
	return out;
}
