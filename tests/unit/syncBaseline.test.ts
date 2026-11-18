/*
	syncBaseline tests — Dexie-backed CRUD around db.peerSyncBaseline, run
	against the real Dexie `db` (backed by fake-indexeddb, see tests/setup.ts).
	fake-indexeddb persists data across tests within this file's module
	registry, so each test uses a unique endpointId to avoid cross-test
	interference rather than relying on a fresh DB per test.
*/

import db from '#lib/data/db';
import { TrustedPeer } from '#lib/data/model';
import { diffAgainstBaseline } from '#lib/sync/syncDiff';
import {
	buildAnnouncement,
	clearBaseline,
	getBaseline,
	initializePeerBaseline,
	recordPeerAnnouncement,
	removeBaselineEntries,
	updateBaseline
} from '#lib/sync/syncBaseline';
import type { FileFingerprint, SyncEntry } from '#lib/sync/SyncSource';
import { assert, test } from 'vitest';

/** The baseline initializer only acts for a trusted peer, so tests create one. */
async function trustPeer(endpointId: string): Promise<void> {
	await db.peers.put(
		Object.assign(new TrustedPeer(), {
			id: endpointId,
			name: 'Peer',
			trustedAt: new Date().toISOString()
		})
	);
}

const fingerprint = (path: string, hash: string): FileFingerprint => ({ path, hash });

test('updateBaseline upserts rows readable back via getBaseline', async () => {
	const endpointId = 'endpoint-upsert-read';

	await updateBaseline(endpointId, [
		{
			path: 'a.beancount',
			local: { path: 'a.beancount', size: 100, lastModified: 1000, hash: 'hash-a-local' },
			remote: { path: 'a.beancount', size: 100, lastModified: 9000, hash: 'hash-a-remote' }
		},
		{
			path: 'b.beancount',
			local: { path: 'b.beancount', size: 200, lastModified: 2000, hash: 'hash-b-local' },
			remote: { path: 'b.beancount', size: 200, lastModified: 8000, hash: 'hash-b-remote' }
		}
	]);

	const baseline = await getBaseline(endpointId);

	assert.equal(baseline.size, 2);
	const a = baseline.get('a.beancount');
	assert.ok(a, 'expected a.beancount to be present');
	assert.equal(a!.endpointId, endpointId);
	assert.equal(a!.path, 'a.beancount');
	assert.equal(a!.localHash, 'hash-a-local');
	// Recorded independently from the local side — a device's content hash for
	// the synced file is never expected to equal the peer's hash for it (that
	// only happens once both sides truly hold identical bytes).
	assert.equal(a!.remoteHash, 'hash-a-remote');
	assert.isString(a!.syncedAt);
	assert.isNotEmpty(a!.syncedAt);
	assert.isFalse(Number.isNaN(new Date(a!.syncedAt).getTime()), 'syncedAt must parse as a Date');
});

test('getBaseline scopes strictly to the given endpointId', async () => {
	const endpointA = 'endpoint-scope-a';
	const endpointB = 'endpoint-scope-b';

	await updateBaseline(endpointA, [
		{
			path: 'shared-name.beancount',
			local: { path: 'shared-name.beancount', size: 1, lastModified: 1, hash: 'hash-shared-local' },
			remote: {
				path: 'shared-name.beancount',
				size: 1,
				lastModified: 2,
				hash: 'hash-shared-remote'
			}
		}
	]);
	await updateBaseline(endpointB, [
		{
			path: 'other.beancount',
			local: { path: 'other.beancount', size: 2, lastModified: 2, hash: 'hash-other-local' },
			remote: { path: 'other.beancount', size: 2, lastModified: 3, hash: 'hash-other-remote' }
		}
	]);

	const baselineA = await getBaseline(endpointA);
	const baselineB = await getBaseline(endpointB);

	assert.equal(baselineA.size, 1);
	assert.isTrue(baselineA.has('shared-name.beancount'));
	assert.isFalse(baselineA.has('other.beancount'), "endpoint A must not see endpoint B's rows");

	assert.equal(baselineB.size, 1);
	assert.isTrue(baselineB.has('other.beancount'));
	assert.isFalse(
		baselineB.has('shared-name.beancount'),
		"endpoint B must not see endpoint A's rows"
	);
});

test('updateBaseline overwrites an existing row for the same endpointId+path (upsert)', async () => {
	const endpointId = 'endpoint-overwrite';

	await updateBaseline(endpointId, [
		{
			path: 'a.beancount',
			local: { path: 'a.beancount', size: 100, lastModified: 1000, hash: 'hash-v1-local' },
			remote: { path: 'a.beancount', size: 100, lastModified: 1100, hash: 'hash-v1-remote' }
		}
	]);
	await updateBaseline(endpointId, [
		{
			path: 'a.beancount',
			local: { path: 'a.beancount', size: 999, lastModified: 5000, hash: 'hash-v2-local' },
			remote: { path: 'a.beancount', size: 999, lastModified: 5200, hash: 'hash-v2-remote' }
		}
	]);

	const baseline = await getBaseline(endpointId);

	assert.equal(baseline.size, 1, 'second update must overwrite, not duplicate, the row');
	const row = baseline.get('a.beancount');
	assert.ok(row);
	assert.equal(row!.localHash, 'hash-v2-local');
	assert.equal(row!.remoteHash, 'hash-v2-remote');
});

test('removeBaselineEntries deletes only the specified paths for that endpoint', async () => {
	const endpointId = 'endpoint-remove';

	await updateBaseline(endpointId, [
		{
			path: 'keep.beancount',
			local: { path: 'keep.beancount', size: 1, lastModified: 1, hash: 'hash-keep-local' },
			remote: { path: 'keep.beancount', size: 1, lastModified: 1, hash: 'hash-keep-remote' }
		},
		{
			path: 'drop.beancount',
			local: { path: 'drop.beancount', size: 2, lastModified: 2, hash: 'hash-drop-local' },
			remote: { path: 'drop.beancount', size: 2, lastModified: 2, hash: 'hash-drop-remote' }
		}
	]);

	await removeBaselineEntries(endpointId, ['drop.beancount']);

	const baseline = await getBaseline(endpointId);

	assert.equal(baseline.size, 1);
	assert.isTrue(baseline.has('keep.beancount'), 'untouched path must remain');
	assert.isFalse(baseline.has('drop.beancount'), 'removed path must be gone');
});

const syncEntry = (path: string, hash: string) => ({ path, size: 1, lastModified: 1, hash });

test('recordPeerAnnouncement records both halves when our copy is what the peer synced from', async () => {
	const endpointId = 'endpoint-announce-ok';
	// The peer pulled our copy (hash "ours") and now holds "ours" too.
	const announcement = buildAnnouncement(
		[
			{
				path: 'a.beancount',
				local: syncEntry('a.beancount', 'ours'),
				remote: syncEntry('a.beancount', 'ours')
			}
		],
		[]
	);

	await recordPeerAnnouncement(endpointId, announcement, [syncEntry('a.beancount', 'ours')]);

	const row = (await getBaseline(endpointId)).get('a.beancount');
	assert.equal(row?.localHash, 'ours');
	assert.equal(row?.remoteHash, 'ours');
});

test('recordPeerAnnouncement records the merged hash as the peer side after a merge', async () => {
	const endpointId = 'endpoint-announce-merge';
	// Peer merged: it now holds "merged", having read our "ours".
	const announcement = buildAnnouncement(
		[
			{
				path: 'a.beancount',
				local: syncEntry('a.beancount', 'merged'),
				remote: syncEntry('a.beancount', 'ours')
			}
		],
		[]
	);

	await recordPeerAnnouncement(endpointId, announcement, [syncEntry('a.beancount', 'ours')]);

	const row = (await getBaseline(endpointId)).get('a.beancount');
	assert.equal(row?.localHash, 'ours');
	assert.equal(row?.remoteHash, 'merged');
});

test('recordPeerAnnouncement ignores a path we edited since the peer read it', async () => {
	const endpointId = 'endpoint-announce-stale';
	const announcement = buildAnnouncement(
		[
			{
				path: 'a.beancount',
				local: syncEntry('a.beancount', 'ours'),
				remote: syncEntry('a.beancount', 'ours')
			}
		],
		[]
	);

	await recordPeerAnnouncement(endpointId, announcement, [
		syncEntry('a.beancount', 'edited-since')
	]);

	assert.isFalse((await getBaseline(endpointId)).has('a.beancount'));
});

test('recordPeerAnnouncement drops the baseline for a deletion we have also made', async () => {
	const endpointId = 'endpoint-announce-delete';
	await updateBaseline(endpointId, [
		{
			path: 'gone.beancount',
			local: syncEntry('gone.beancount', 'x'),
			remote: syncEntry('gone.beancount', 'x')
		},
		{
			path: 'kept.beancount',
			local: syncEntry('kept.beancount', 'y'),
			remote: syncEntry('kept.beancount', 'y')
		}
	]);

	await recordPeerAnnouncement(
		endpointId,
		buildAnnouncement([], ['gone.beancount', 'kept.beancount']),
		[syncEntry('kept.beancount', 'y')]
	);

	const baseline = await getBaseline(endpointId);
	assert.isFalse(baseline.has('gone.beancount'));
	assert.isTrue(baseline.has('kept.beancount'), 'a file we still have must keep its baseline');
});

test('initializePeerBaseline seeds both-sided and local-only paths, but not remote-only ones', async () => {
	const endpointId = 'endpoint-init-pairing';
	await trustPeer(endpointId);

	await initializePeerBaseline(
		endpointId,
		[fingerprint('both.bean', 'local-both'), fingerprint('local.bean', 'local-only')],
		[fingerprint('both.bean', 'remote-both'), fingerprint('remote.bean', 'remote-only')]
	);

	const baseline = await getBaseline(endpointId);
	assert.equal(baseline.size, 2);
	assert.equal(baseline.get('both.bean')?.localHash, 'local-both');
	assert.equal(baseline.get('both.bean')?.remoteHash, 'remote-both');
	assert.equal(baseline.get('local.bean')?.localHash, 'local-only');
	assert.isNull(baseline.get('local.bean')?.remoteHash);
	assert.isFalse(
		baseline.has('remote.bean'),
		'a file only the peer has must stay without a baseline, so the first sync still pulls it'
	);
	assert.isString((await db.peers.get(endpointId))?.fileSyncInitializedAt);

	// The point of seeding: a file that differed before pairing is the starting
	// state, not a conflict waiting to be confirmed.
	const [row] = diffAgainstBaseline(
		[syncEntry('both.bean', 'local-both')],
		[syncEntry('both.bean', 'remote-both')],
		baseline
	);
	assert.equal(row.status, 'unchanged');
});

test('initializePeerBaseline ignores a device that is not trusted', async () => {
	const endpointId = 'endpoint-init-untrusted';
	await initializePeerBaseline(
		endpointId,
		[fingerprint('a.bean', 'local')],
		[fingerprint('a.bean', 'remote')]
	);
	assert.equal((await getBaseline(endpointId)).size, 0);
});

test('initializePeerBaseline does nothing after the first seeding', async () => {
	const endpointId = 'endpoint-init-once';
	await trustPeer(endpointId);
	await initializePeerBaseline(
		endpointId,
		[fingerprint('a.bean', 'paired-local')],
		[fingerprint('a.bean', 'paired-remote')]
	);

	await initializePeerBaseline(
		endpointId,
		[fingerprint('a.bean', 'edited-local'), fingerprint('new.bean', 'new-local')],
		[fingerprint('a.bean', 'edited-remote'), fingerprint('new.bean', 'new-remote')]
	);

	const baseline = await getBaseline(endpointId);
	assert.equal(baseline.get('a.bean')?.localHash, 'paired-local');
	assert.equal(baseline.get('a.bean')?.remoteHash, 'paired-remote');
	assert.isFalse(
		baseline.has('new.bean'),
		'files first seen after pairing are not folded into the base'
	);
});

test('after seeding, a remote deletion is a one-sided change instead of an unknown difference', async () => {
	const endpointId = 'endpoint-init-delete';
	await trustPeer(endpointId);
	const file: SyncEntry = { path: 'book.bean', size: 1, lastModified: 1, hash: 'same' };
	await initializePeerBaseline(endpointId, [file], [file]);

	const [row] = diffAgainstBaseline([file], [], await getBaseline(endpointId));
	assert.equal(row.status, 'remote-newer');
	assert.equal(row.action, 'pull');
});

test('initializePeerBaseline leaves an existing baseline row untouched', async () => {
	const endpointId = 'endpoint-init-existing';
	await trustPeer(endpointId);
	await updateBaseline(endpointId, [
		{
			path: 'a.bean',
			local: syncEntry('a.bean', 'synced-local'),
			remote: syncEntry('a.bean', 'synced-remote')
		}
	]);

	await initializePeerBaseline(
		endpointId,
		[fingerprint('a.bean', 'current-local'), fingerprint('b.bean', 'new-local')],
		[fingerprint('a.bean', 'current-remote'), fingerprint('b.bean', 'new-remote')]
	);

	const baseline = await getBaseline(endpointId);
	assert.equal(baseline.get('a.bean')?.localHash, 'synced-local');
	assert.equal(baseline.get('b.bean')?.localHash, 'new-local');
});

test('clearBaseline wipes every row for one endpoint, leaving another endpoint intact', async () => {
	const endpointA = 'endpoint-clear-a';
	const endpointB = 'endpoint-clear-b';

	await updateBaseline(endpointA, [
		{
			path: 'x.beancount',
			local: { path: 'x.beancount', size: 1, lastModified: 1, hash: 'hash-x-local' },
			remote: { path: 'x.beancount', size: 1, lastModified: 1, hash: 'hash-x-remote' }
		}
	]);
	await updateBaseline(endpointB, [
		{
			path: 'y.beancount',
			local: { path: 'y.beancount', size: 2, lastModified: 2, hash: 'hash-y-local' },
			remote: { path: 'y.beancount', size: 2, lastModified: 2, hash: 'hash-y-remote' }
		}
	]);

	await clearBaseline(endpointA);

	const baselineA = await getBaseline(endpointA);
	const baselineB = await getBaseline(endpointB);

	assert.equal(baselineA.size, 0, 'cleared endpoint must have no rows left');
	assert.equal(baselineB.size, 1, 'other endpoint must be untouched');
	assert.isTrue(baselineB.has('y.beancount'));
});
