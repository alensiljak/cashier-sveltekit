/*
	syncDiff tests — pure classification logic in diffAgainstBaseline. No
	Dexie/IndexedDB involved; baseline is passed in directly as a Map, so
	these are plain synchronous unit tests. See src/lib/sync/syncDiff.ts.
*/

import type { PeerSyncBaseline } from '$lib/data/model';
import { diffAgainstBaseline } from '$lib/sync/syncDiff';
import type { SyncEntry } from '$lib/sync/SyncSource';
import { assert, test } from 'vitest';

/** Builds a SyncEntry literal. */
function entry(path: string, size: number, lastModified: number): SyncEntry {
	return { path, size, lastModified };
}

/** Builds a PeerSyncBaseline-shaped row (syncedAt is irrelevant to diffing, so it's fixed). */
function baselineRow(path: string, size: number, lastModified: number): PeerSyncBaseline {
	return { endpointId: 'endpoint-1', path, size, lastModified, syncedAt: '2026-01-01T00:00:00.000Z' };
}

function baselineMap(...rows: PeerSyncBaseline[]): Map<string, PeerSyncBaseline> {
	return new Map(rows.map((r) => [r.path, r]));
}

test('unchanged: both local and remote match the baseline', () => {
	const local = [entry('a.beancount', 100, 1000)];
	const remote = [entry('a.beancount', 100, 1000)];
	const baseline = baselineMap(baselineRow('a.beancount', 100, 1000));

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result.length, 1);
	assert.equal(result[0].path, 'a.beancount');
	assert.equal(result[0].status, 'unchanged');
	assert.equal(result[0].action, 'skip');
});

test('local-newer: only local metadata differs from baseline', () => {
	const local = [entry('a.beancount', 200, 2000)];
	const remote = [entry('a.beancount', 100, 1000)];
	const baseline = baselineMap(baselineRow('a.beancount', 100, 1000));

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result[0].status, 'local-newer');
	assert.equal(result[0].action, 'skip');
});

test('remote-newer: only remote metadata differs from baseline', () => {
	const local = [entry('a.beancount', 100, 1000)];
	const remote = [entry('a.beancount', 200, 2000)];
	const baseline = baselineMap(baselineRow('a.beancount', 100, 1000));

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result[0].status, 'remote-newer');
	assert.equal(result[0].action, 'pull');
});

test('conflict: both local and remote differ from baseline', () => {
	const local = [entry('a.beancount', 200, 2000)];
	const remote = [entry('a.beancount', 300, 3000)];
	const baseline = baselineMap(baselineRow('a.beancount', 100, 1000));

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result[0].status, 'conflict');
	assert.equal(result[0].action, 'conflict');
});

test('no baseline at all, present on both sides: both sides count as changed -> conflict', () => {
	// Neither side has ever been recorded for this path, so there is nothing to
	// confirm a match against — changedSinceBaseline returns true for a
	// present entry when baseline is undefined, on both sides.
	const local = [entry('never-synced.beancount', 100, 1000)];
	const remote = [entry('never-synced.beancount', 100, 1000)];
	const baseline = baselineMap(); // empty — no row for this path

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result[0].status, 'conflict');
	assert.equal(result[0].action, 'conflict');
});

test('new remote file: no local entry and no baseline -> remote-newer/pull', () => {
	// Local side: entry undefined AND baseline undefined -> changedSinceBaseline
	// returns `baseline !== undefined` which is false, so local counts as
	// UNCHANGED here (nothing local ever existed to be behind on).
	// Remote side: entry present, baseline undefined -> changed (true).
	const local: SyncEntry[] = [];
	const remote = [entry('new-remote-only.beancount', 50, 500)];
	const baseline = baselineMap();

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result.length, 1);
	assert.equal(result[0].status, 'remote-newer');
	assert.equal(result[0].action, 'pull');
	assert.isUndefined(result[0].local);
	assert.deepEqual(result[0].remote, remote[0]);
});

test('local-only file: no remote entry and no baseline -> local-newer/skip', () => {
	// Mirror of the previous case: remote entry undefined + baseline undefined
	// -> remote counts as unchanged; local entry present + baseline undefined
	// -> local counts as changed.
	const local = [entry('local-only.beancount', 50, 500)];
	const remote: SyncEntry[] = [];
	const baseline = baselineMap();

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result.length, 1);
	assert.equal(result[0].status, 'local-newer');
	assert.equal(result[0].action, 'skip');
	assert.deepEqual(result[0].local, local[0]);
	assert.isUndefined(result[0].remote);
});

test('deletion: local side deleted since baseline, remote unchanged -> local-newer/skip', () => {
	// entry undefined + baseline defined -> changedSinceBaseline returns true
	// (baseline !== undefined), so a deletion counts as "changed" on that side.
	const local: SyncEntry[] = [];
	const remote = [entry('deleted-locally.beancount', 100, 1000)];
	const baseline = baselineMap(baselineRow('deleted-locally.beancount', 100, 1000));

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result[0].status, 'local-newer');
	assert.equal(result[0].action, 'skip');
	assert.isUndefined(result[0].local);
	assert.deepEqual(result[0].remote, remote[0]);
});

test('deletion: remote side deleted since baseline, local unchanged -> remote-newer/pull', () => {
	const local = [entry('deleted-remotely.beancount', 100, 1000)];
	const remote: SyncEntry[] = [];
	const baseline = baselineMap(baselineRow('deleted-remotely.beancount', 100, 1000));

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result[0].status, 'remote-newer');
	assert.equal(result[0].action, 'pull');
	assert.deepEqual(result[0].local, local[0]);
	assert.isUndefined(result[0].remote);
});

test('deletion: both sides deleted since baseline -> path is dropped entirely', () => {
	// diffAgainstBaseline only classifies the union of paths present in the
	// local/remote scans (see its docstring). A path absent from BOTH scans
	// never enters that union, so even though a baseline row exists for it,
	// it produces no output row at all — there's nothing left to sync.
	const local: SyncEntry[] = [];
	const remote: SyncEntry[] = [];
	const baseline = baselineMap(baselineRow('deleted-both.beancount', 100, 1000));

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result.length, 0);
});

test('result is sorted by path regardless of scrambled input order', () => {
	const paths = ['zebra.beancount', 'apple.beancount', 'mango.beancount', 'banana.beancount'];
	// Feed local/remote in a scrambled, non-alphabetical, non-matching order,
	// all unchanged against a matching baseline so status doesn't matter here.
	const scrambledLocal = [paths[2], paths[0], paths[3], paths[1]].map((p) => entry(p, 10, 100));
	const scrambledRemote = [paths[1], paths[3], paths[0], paths[2]].map((p) => entry(p, 10, 100));
	const baseline = baselineMap(...paths.map((p) => baselineRow(p, 10, 100)));

	const result = diffAgainstBaseline(scrambledLocal, scrambledRemote, baseline);

	assert.deepEqual(
		result.map((r) => r.path),
		[...paths].sort((a, b) => a.localeCompare(b))
	);
});
