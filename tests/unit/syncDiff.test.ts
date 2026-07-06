/*
	syncDiff tests — pure classification logic in diffAgainstBaseline. No
	Dexie/IndexedDB involved; baseline is passed in directly as a Map, so
	these are plain synchronous unit tests. See src/lib/sync/syncDiff.ts.
*/

import type { PeerSyncBaseline } from '$lib/data/model';
import { diffAgainstBaseline } from '$lib/sync/syncDiff';
import type { SyncEntry } from '$lib/sync/SyncSource';
import { assert, test } from 'vitest';

/** Builds a SyncEntry literal. size/lastModified no longer drive any diff
 *  assertion (classification is purely hash-based now), so they get
 *  harmless defaults but stay present since SyncEntry still requires them. */
function entry(path: string, hash: string, size = 100, lastModified = 1000): SyncEntry {
	return { path, size, lastModified, hash };
}

/**
 * Builds a PeerSyncBaseline-shaped row (syncedAt is irrelevant to diffing, so
 * it's fixed). Local and remote halves are independent — see
 * PeerSyncBaseline's doc comment for why a single shared value can't
 * represent both sides.
 */
function baselineRow(path: string, localHash: string, remoteHash: string): PeerSyncBaseline {
	return {
		endpointId: 'endpoint-1',
		path,
		localHash,
		remoteHash,
		syncedAt: '2026-01-01T00:00:00.000Z'
	};
}

function baselineMap(...rows: PeerSyncBaseline[]): Map<string, PeerSyncBaseline> {
	return new Map(rows.map((r) => [r.path, r]));
}

test('unchanged: both local and remote match their own half of the baseline', () => {
	const local = [entry('a.beancount', 'hash-1')];
	const remote = [entry('a.beancount', 'hash-1')];
	const baseline = baselineMap(baselineRow('a.beancount', 'hash-1', 'hash-1'));

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result.length, 1);
	assert.equal(result[0].path, 'a.beancount');
	assert.equal(result[0].status, 'unchanged');
	assert.equal(result[0].action, 'skip');
});

test('unchanged despite local and remote hashes differing from each other, as long as each side matches its own recorded baseline half', () => {
	// Local and remote can legitimately hold different content hashes (e.g.
	// local hasn't pulled remote's latest edit yet) while still each being
	// individually "unchanged" relative to what THAT side looked like at the
	// last sync — the baseline's two halves are recorded independently, so a
	// side only counts as changed when it diverges from its OWN half, never
	// by comparing against the other side's hash. This is distinct from the
	// hash-equality shortcut (local.hash === remote.hash), which doesn't
	// apply here since the two hashes differ.
	const local = [entry('a.beancount', 'hash-local')];
	const remote = [entry('a.beancount', 'hash-remote')];
	const baseline = baselineMap(baselineRow('a.beancount', 'hash-local', 'hash-remote'));

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result[0].status, 'unchanged');
	assert.equal(result[0].action, 'skip');
});

test('unchanged: local and remote hashes match outright, even with no baseline recorded', () => {
	// classify()'s hash-equality shortcut fires whenever local and remote
	// currently hold the same content hash, independent of baseline state —
	// no prior sync round trip is needed to confirm two sides agree, unlike
	// the old metadata model where a fresh baseline row was required.
	const local = [entry('never-synced.beancount', 'hash-same')];
	const remote = [entry('never-synced.beancount', 'hash-same')];
	const baseline = baselineMap(); // no row at all for this path

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result[0].status, 'unchanged');
	assert.equal(result[0].action, 'skip');
});

test('local-newer: only local hash differs from its baseline half', () => {
	const local = [entry('a.beancount', 'hash-2')];
	const remote = [entry('a.beancount', 'hash-1')];
	const baseline = baselineMap(baselineRow('a.beancount', 'hash-1', 'hash-1'));

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result[0].status, 'local-newer');
	assert.equal(result[0].action, 'skip');
});

test('remote-newer: only remote hash differs from its baseline half', () => {
	const local = [entry('a.beancount', 'hash-1')];
	const remote = [entry('a.beancount', 'hash-2')];
	const baseline = baselineMap(baselineRow('a.beancount', 'hash-1', 'hash-1'));

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result[0].status, 'remote-newer');
	assert.equal(result[0].action, 'pull');
});

test('conflict: both local and remote differ from their baseline halves', () => {
	const local = [entry('a.beancount', 'hash-2')];
	const remote = [entry('a.beancount', 'hash-3')];
	const baseline = baselineMap(baselineRow('a.beancount', 'hash-1', 'hash-1'));

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result[0].status, 'conflict');
	assert.equal(result[0].action, 'conflict');
});

test('no baseline at all, present on both sides: both sides count as changed -> conflict', () => {
	// Neither side has ever been recorded for this path, so there is nothing to
	// confirm a match against — changedSinceBaseline returns true for a
	// present entry when its baseline half is undefined, on both sides. Local
	// and remote also hold different hashes here, so the hash-equality
	// shortcut doesn't mask this case.
	const local = [entry('never-synced.beancount', 'hash-local')];
	const remote = [entry('never-synced.beancount', 'hash-remote')];
	const baseline = baselineMap(); // empty — no row for this path

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result[0].status, 'conflict');
	assert.equal(result[0].action, 'conflict');
});

test('new remote file: no local entry and no baseline -> remote-newer/pull', () => {
	// Local side: entry undefined AND baseline half undefined -> changedSinceBaseline
	// returns false, so local counts as UNCHANGED here (nothing local ever
	// existed to be behind on).
	// Remote side: entry present, baseline half undefined -> changed (true).
	const local: SyncEntry[] = [];
	const remote = [entry('new-remote-only.beancount', 'hash-remote')];
	const baseline = baselineMap();

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result.length, 1);
	assert.equal(result[0].status, 'remote-newer');
	assert.equal(result[0].action, 'pull');
	assert.isUndefined(result[0].local);
	assert.deepEqual(result[0].remote, remote[0]);
});

test('local-only file: no remote entry and no baseline -> local-newer/skip', () => {
	// Mirror of the previous case: remote entry undefined + baseline half
	// undefined -> remote counts as unchanged; local entry present + baseline
	// half undefined -> local counts as changed.
	const local = [entry('local-only.beancount', 'hash-local')];
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
	// entry undefined + baseline half defined -> changedSinceBaseline returns
	// true, so a deletion counts as "changed" on that side.
	const local: SyncEntry[] = [];
	const remote = [entry('deleted-locally.beancount', 'hash-1')];
	const baseline = baselineMap(baselineRow('deleted-locally.beancount', 'hash-1', 'hash-1'));

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result[0].status, 'local-newer');
	assert.equal(result[0].action, 'skip');
	assert.isUndefined(result[0].local);
	assert.deepEqual(result[0].remote, remote[0]);
});

test('deletion: remote side deleted since baseline, local unchanged -> remote-newer/pull', () => {
	const local = [entry('deleted-remotely.beancount', 'hash-1')];
	const remote: SyncEntry[] = [];
	const baseline = baselineMap(baselineRow('deleted-remotely.beancount', 'hash-1', 'hash-1'));

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
	const baseline = baselineMap(baselineRow('deleted-both.beancount', 'hash-1', 'hash-1'));

	const result = diffAgainstBaseline(local, remote, baseline);

	assert.equal(result.length, 0);
});

test('result is sorted by path regardless of scrambled input order', () => {
	const paths = ['zebra.beancount', 'apple.beancount', 'mango.beancount', 'banana.beancount'];
	// Feed local/remote in a scrambled, non-alphabetical, non-matching order,
	// all unchanged against a matching baseline so status doesn't matter here.
	const scrambledLocal = [paths[2], paths[0], paths[3], paths[1]].map((p) => entry(p, 'hash-x'));
	const scrambledRemote = [paths[1], paths[3], paths[0], paths[2]].map((p) => entry(p, 'hash-x'));
	const baseline = baselineMap(...paths.map((p) => baselineRow(p, 'hash-x', 'hash-x')));

	const result = diffAgainstBaseline(scrambledLocal, scrambledRemote, baseline);

	assert.deepEqual(
		result.map((r) => r.path),
		[...paths].sort((a, b) => a.localeCompare(b))
	);
});
