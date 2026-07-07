/*
	keyedMerge tests — pure structural diff/merge logic in diffKeyed and
	resolveKeyedMerge. No Dexie/IndexedDB involved; item arrays are passed in
	directly, so these are plain synchronous unit tests. See
	src/lib/utils/keyedMerge.ts.
*/

import { diffKeyed, resolveKeyedMerge, type KeyedDiffEntry } from '$lib/utils/keyedMerge';
import { assert, test } from 'vitest';

/** A plain record item keyed by `id`, with a `value` payload that participates
 *  in default JSON-based equality. */
interface Item {
	id: string;
	value: string;
}

function item(id: string, value: string): Item {
	return { id, value };
}

function keyOfItem(i: Item): string {
	return i.id;
}

/** A record item with an `ignored` field that should NOT affect equality
 *  when a custom `equal` is supplied that only compares `value`. */
interface TaggedItem {
	id: string;
	value: string;
	ignored: string;
}

function tagged(id: string, value: string, ignored: string): TaggedItem {
	return { id, value, ignored };
}

function keyOfTagged(i: TaggedItem): string {
	return i.id;
}

function equalByValue(a: TaggedItem, b: TaggedItem): boolean {
	return a.value === b.value;
}

test('unchanged items (identical by default JSON equality) are omitted from the diff', () => {
	const local = [item('a', '1'), item('b', '2')];
	const remote = [item('a', '1'), item('b', '2')];
	const entries = diffKeyed(local, remote, keyOfItem);
	assert.deepEqual(entries, []);
});

test('unchanged items under a custom equal function are omitted even when other fields differ', () => {
	const local = [tagged('a', 'same', 'local-tag')];
	const remote = [tagged('a', 'same', 'remote-tag')];
	const entries = diffKeyed(local, remote, keyOfTagged, equalByValue);
	assert.deepEqual(entries, []);
});

test('a key present on both sides with differing values is classified as changed, keeping both copies', () => {
	const local = [item('a', '1')];
	const remote = [item('a', '2')];
	const entries = diffKeyed(local, remote, keyOfItem);
	assert.deepEqual(entries, [
		{ key: 'a', status: 'changed', local: item('a', '1'), remote: item('a', '2') }
	]);
});

test('a key present under a custom equal function is classified as changed when the compared field differs', () => {
	const local = [tagged('a', 'old', 'x')];
	const remote = [tagged('a', 'new', 'x')];
	const entries = diffKeyed(local, remote, keyOfTagged, equalByValue);
	assert.deepEqual(entries, [
		{
			key: 'a',
			status: 'changed',
			local: tagged('a', 'old', 'x'),
			remote: tagged('a', 'new', 'x')
		}
	]);
});

test('a key present only in local is classified as removed, carrying only the local copy', () => {
	const local = [item('a', '1')];
	const remote: Item[] = [];
	const entries = diffKeyed(local, remote, keyOfItem);
	assert.deepEqual(entries, [{ key: 'a', status: 'removed', local: item('a', '1') }]);
});

test('a key present only in remote is classified as added, carrying only the remote copy', () => {
	const local: Item[] = [];
	const remote = [item('a', '1')];
	const entries = diffKeyed(local, remote, keyOfItem);
	assert.deepEqual(entries, [{ key: 'a', status: 'added', remote: item('a', '1') }]);
});

test('result is sorted by key ascending regardless of scrambled input order', () => {
	const local = [item('c', '1'), item('a', '1'), item('e', '1')];
	const remote = [item('b', '1'), item('d', '1'), item('a', '2')];
	const entries = diffKeyed(local, remote, keyOfItem);
	assert.deepEqual(
		entries.map((e) => e.key),
		['a', 'b', 'c', 'd', 'e']
	);
	assert.equal(entries[0].status, 'changed'); // a
	assert.equal(entries[1].status, 'added'); // b
	assert.equal(entries[2].status, 'removed'); // c
	assert.equal(entries[3].status, 'added'); // d
	assert.equal(entries[4].status, 'removed'); // e
});

test('a mix of unchanged, added, removed, and changed keys produces only the non-unchanged entries, sorted', () => {
	const local = [item('unchanged', 'x'), item('removed', 'x'), item('changed', 'old')];
	const remote = [item('unchanged', 'x'), item('added', 'y'), item('changed', 'new')];
	const entries = diffKeyed(local, remote, keyOfItem);
	assert.deepEqual(
		entries.map((e) => ({ key: e.key, status: e.status })),
		[
			{ key: 'added', status: 'added' },
			{ key: 'changed', status: 'changed' },
			{ key: 'removed', status: 'removed' }
		]
	);
});

test('resolveKeyedMerge with no entries returns local untouched', () => {
	const local = [item('a', '1'), item('b', '2')];
	const merged = resolveKeyedMerge(local, [], keyOfItem, new Set());
	assert.deepEqual(merged, local);
});

test('resolveKeyedMerge defaults every entry to Theirs when rejected is empty: remote values win, additions included, removals dropped', () => {
	const local = [item('unchanged', 'x'), item('removed', 'x'), item('changed', 'old')];
	const remote = [item('unchanged', 'x'), item('added', 'y'), item('changed', 'new')];
	const entries = diffKeyed(local, remote, keyOfItem);
	const merged = resolveKeyedMerge(local, entries, keyOfItem, new Set());
	const byKey = new Map(merged.map((i) => [i.id, i]));
	assert.deepEqual([...byKey.keys()].sort(), ['added', 'changed', 'unchanged']);
	assert.equal(byKey.get('unchanged')!.value, 'x');
	assert.equal(byKey.get('added')!.value, 'y');
	assert.equal(byKey.get('changed')!.value, 'new');
	assert.isUndefined(byKey.get('removed'));
});

test('resolveKeyedMerge with every key rejected (all Mine) reproduces local exactly: additions excluded, removals kept, changed keeps local', () => {
	const local = [item('unchanged', 'x'), item('removed', 'x'), item('changed', 'old')];
	const remote = [item('unchanged', 'x'), item('added', 'y'), item('changed', 'new')];
	const entries = diffKeyed(local, remote, keyOfItem);
	const rejected = new Set(entries.map((e) => e.key));
	const merged = resolveKeyedMerge(local, entries, keyOfItem, rejected);
	assert.deepEqual(
		[...merged].sort((a, b) => a.id.localeCompare(b.id)),
		[...local].sort((a, b) => a.id.localeCompare(b.id))
	);
});

test('resolveKeyedMerge with independent per-entry picks: a removed entry kept as Mine and an added entry taken as Theirs both survive ("keep both")', () => {
	const local = [item('removed', 'local-copy')];
	const remote = [item('added', 'remote-copy')];
	const entries = diffKeyed(local, remote, keyOfItem);
	assert.equal(entries.length, 2);
	// Reject (Mine) the removed entry so its local copy is kept; leave the
	// added entry at its default (Theirs) so the remote copy is also kept.
	const rejected = new Set(['removed']);
	const merged = resolveKeyedMerge(local, entries, keyOfItem, rejected);
	const byKey = new Map(merged.map((i) => [i.id, i]));
	assert.equal(byKey.size, 2);
	assert.equal(byKey.get('removed')!.value, 'local-copy');
	assert.equal(byKey.get('added')!.value, 'remote-copy');
});

test('resolveKeyedMerge on a changed entry picks the local copy outright when rejected (Mine)', () => {
	const local = [item('a', 'old')];
	const remote = [item('a', 'new')];
	const entries = diffKeyed(local, remote, keyOfItem);
	const merged = resolveKeyedMerge(local, entries, keyOfItem, new Set(['a']));
	assert.deepEqual(merged, [item('a', 'old')]);
});

test('resolveKeyedMerge on a changed entry picks the remote copy outright by default (Theirs)', () => {
	const local = [item('a', 'old')];
	const remote = [item('a', 'new')];
	const entries = diffKeyed(local, remote, keyOfItem);
	const merged = resolveKeyedMerge(local, entries, keyOfItem, new Set());
	assert.deepEqual(merged, [item('a', 'new')]);
});

test('resolveKeyedMerge handles a manually constructed entry list independent of diffKeyed, honoring mixed picks per entry', () => {
	const local = [item('kept', 'k'), item('removed', 'r'), item('changed', 'old')];
	const entries: KeyedDiffEntry<Item>[] = [
		{ key: 'removed', status: 'removed', local: item('removed', 'r') },
		{ key: 'added', status: 'added', remote: item('added', 'a') },
		{
			key: 'changed',
			status: 'changed',
			local: item('changed', 'old'),
			remote: item('changed', 'new')
		}
	];
	// removed -> Theirs (drop), added -> Mine (exclude), changed -> Theirs (remote)
	const rejected = new Set(['added']);
	const merged = resolveKeyedMerge(local, entries, keyOfItem, rejected);
	const byKey = new Map(merged.map((i) => [i.id, i]));
	assert.deepEqual([...byKey.keys()].sort(), ['changed', 'kept']);
	assert.equal(byKey.get('kept')!.value, 'k');
	assert.equal(byKey.get('changed')!.value, 'new');
});
