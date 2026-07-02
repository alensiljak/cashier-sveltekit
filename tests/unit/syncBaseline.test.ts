/*
	syncBaseline tests — Dexie-backed CRUD around db.peerSyncBaseline, run
	against the real Dexie `db` (backed by fake-indexeddb, see tests/setup.ts).
	fake-indexeddb persists data across tests within this file's module
	registry, so each test uses a unique endpointId to avoid cross-test
	interference rather than relying on a fresh DB per test.
*/

import {
	clearBaseline,
	getBaseline,
	removeBaselineEntries,
	updateBaseline
} from '$lib/sync/syncBaseline';
import { assert, test } from 'vitest';

test('updateBaseline upserts rows readable back via getBaseline', async () => {
	const endpointId = 'endpoint-upsert-read';

	await updateBaseline(endpointId, [
		{
			path: 'a.beancount',
			local: { path: 'a.beancount', size: 100, lastModified: 1000 },
			remote: { path: 'a.beancount', size: 100, lastModified: 9000 }
		},
		{
			path: 'b.beancount',
			local: { path: 'b.beancount', size: 200, lastModified: 2000 },
			remote: { path: 'b.beancount', size: 200, lastModified: 8000 }
		}
	]);

	const baseline = await getBaseline(endpointId);

	assert.equal(baseline.size, 2);
	const a = baseline.get('a.beancount');
	assert.ok(a, 'expected a.beancount to be present');
	assert.equal(a!.endpointId, endpointId);
	assert.equal(a!.path, 'a.beancount');
	assert.equal(a!.localSize, 100);
	assert.equal(a!.localModified, 1000);
	// Recorded independently from the local side — a device's mtime for the
	// synced content is never expected to equal the peer's mtime for it.
	assert.equal(a!.remoteSize, 100);
	assert.equal(a!.remoteModified, 9000);
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
			local: { path: 'shared-name.beancount', size: 1, lastModified: 1 },
			remote: { path: 'shared-name.beancount', size: 1, lastModified: 2 }
		}
	]);
	await updateBaseline(endpointB, [
		{
			path: 'other.beancount',
			local: { path: 'other.beancount', size: 2, lastModified: 2 },
			remote: { path: 'other.beancount', size: 2, lastModified: 3 }
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
			local: { path: 'a.beancount', size: 100, lastModified: 1000 },
			remote: { path: 'a.beancount', size: 100, lastModified: 1100 }
		}
	]);
	await updateBaseline(endpointId, [
		{
			path: 'a.beancount',
			local: { path: 'a.beancount', size: 999, lastModified: 5000 },
			remote: { path: 'a.beancount', size: 999, lastModified: 5200 }
		}
	]);

	const baseline = await getBaseline(endpointId);

	assert.equal(baseline.size, 1, 'second update must overwrite, not duplicate, the row');
	const row = baseline.get('a.beancount');
	assert.ok(row);
	assert.equal(row!.localSize, 999);
	assert.equal(row!.localModified, 5000);
	assert.equal(row!.remoteSize, 999);
	assert.equal(row!.remoteModified, 5200);
});

test('removeBaselineEntries deletes only the specified paths for that endpoint', async () => {
	const endpointId = 'endpoint-remove';

	await updateBaseline(endpointId, [
		{
			path: 'keep.beancount',
			local: { path: 'keep.beancount', size: 1, lastModified: 1 },
			remote: { path: 'keep.beancount', size: 1, lastModified: 1 }
		},
		{
			path: 'drop.beancount',
			local: { path: 'drop.beancount', size: 2, lastModified: 2 },
			remote: { path: 'drop.beancount', size: 2, lastModified: 2 }
		}
	]);

	await removeBaselineEntries(endpointId, ['drop.beancount']);

	const baseline = await getBaseline(endpointId);

	assert.equal(baseline.size, 1);
	assert.isTrue(baseline.has('keep.beancount'), 'untouched path must remain');
	assert.isFalse(baseline.has('drop.beancount'), 'removed path must be gone');
});

test('clearBaseline wipes every row for one endpoint, leaving another endpoint intact', async () => {
	const endpointA = 'endpoint-clear-a';
	const endpointB = 'endpoint-clear-b';

	await updateBaseline(endpointA, [
		{
			path: 'x.beancount',
			local: { path: 'x.beancount', size: 1, lastModified: 1 },
			remote: { path: 'x.beancount', size: 1, lastModified: 1 }
		}
	]);
	await updateBaseline(endpointB, [
		{
			path: 'y.beancount',
			local: { path: 'y.beancount', size: 2, lastModified: 2 },
			remote: { path: 'y.beancount', size: 2, lastModified: 2 }
		}
	]);

	await clearBaseline(endpointA);

	const baselineA = await getBaseline(endpointA);
	const baselineB = await getBaseline(endpointB);

	assert.equal(baselineA.size, 0, 'cleared endpoint must have no rows left');
	assert.equal(baselineB.size, 1, 'other endpoint must be untouched');
	assert.isTrue(baselineB.has('y.beancount'));
});
