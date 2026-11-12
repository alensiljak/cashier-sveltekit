/*
    Moving a trusted device from its legacy UUID to its key-derived ID: how the others recognise
    it (same key, or a named previous ID that a person confirms), and that nothing is lost.
*/
import { beforeEach, describe, expect, it } from 'vitest';
import db from '#lib/data/db';
import { TrustedPeer } from '#lib/data/model';
import { deviceIdFromPublicKey, generateDeviceKey, signHello } from '#lib/sync/deviceKey';
import { loadIgnoreReasons } from '#lib/sync/deltaSyncRegistry';
import { matchLegacy, peerOf, replaceTrustedRecord } from '#lib/sync/identityMigration';
import { assessHello, buildHello } from '#lib/sync/peerPresence.svelte';
import { trustDevice } from '#lib/sync/ydocDevices';

const UUID = '0b0e2c4a-6f7e-4c2a-9d3a-2f5f0a7a9c11';
const FPS_A = { local: 'AA:AA', remote: 'BB:BB' }; // as device A sees the connection
const FPS_B = { local: 'BB:BB', remote: 'AA:AA' }; // as the receiver sees it

async function switched() {
	const key = await generateDeviceKey();
	return { ...key, id: await deviceIdFromPublicKey(key.publicKey) };
}

function record(id: string, over: Partial<TrustedPeer> = {}): TrustedPeer {
	return Object.assign(new TrustedPeer(), { id, name: 'Phone', trustedAt: 'then' }, over);
}

beforeEach(async () => {
	await db.peers.clear();
	await db.peerSyncBaseline.clear();
});

describe('matchLegacy', () => {
	it('finds a record with the same key (rekey) without needing the previous ID', async () => {
		const d = await switched();
		const old = record(UUID, { publicKey: d.publicKey });
		expect(matchLegacy({ id: d.id, publicKey: d.publicKey }, [old])).toEqual({
			kind: 'rekey',
			record: old
		});
	});

	it('finds a key-less record only by the previous ID the device names, and asks for approval', async () => {
		const d = await switched();
		const keyless = record(UUID);
		expect(matchLegacy({ id: d.id, publicKey: d.publicKey }, [keyless])).toBeNull();
		expect(matchLegacy({ id: d.id, publicKey: d.publicKey, previousId: UUID }, [keyless])).toEqual({
			kind: 'approve',
			record: keyless
		});
		// Naming the ID of a record that holds a *different* key proves nothing and matches nothing.
		const other = record(UUID, { publicKey: 'someone-else' });
		expect(matchLegacy({ id: d.id, publicKey: d.publicKey, previousId: UUID }, [other])).toBeNull();
	});

	it('does nothing for a legacy ID, or when the device is trusted under its new ID already', async () => {
		const d = await switched();
		expect(
			matchLegacy({ id: UUID, publicKey: d.publicKey }, [record('x', { publicKey: d.publicKey })])
		).toBeNull();
		expect(
			matchLegacy({ id: d.id, publicKey: d.publicKey }, [
				record(d.id, { publicKey: d.publicKey }),
				record(UUID, { publicKey: d.publicKey })
			])
		).toBeNull();
	});

	it('finds a record by a legacy ID it already holds', () => {
		const migrated = record('newid', { legacyIds: [UUID] });
		expect(peerOf([migrated], UUID)).toBe(migrated);
		expect(peerOf([migrated], 'newid')).toBe(migrated);
		expect(peerOf([migrated], 'other')).toBeUndefined();
	});
});

describe('replaceTrustedRecord', () => {
	it('re-keys the record in one go, keeping label, flags and baselines', async () => {
		const d = await switched();
		await db.peers.put(
			record(UUID, {
				name: "Anna's phone",
				readOnly: true,
				addedBy: 'intro',
				publicKey: d.publicKey
			})
		);
		await db.peerSyncBaseline.bulkPut([
			{ endpointId: UUID, path: 'a.bean', localHash: 'l', remoteHash: 'r', syncedAt: 't' },
			{ endpointId: 'other', path: 'a.bean', localHash: 'l', remoteHash: 'r', syncedAt: 't' }
		]);

		const tp = await replaceTrustedRecord(UUID, {
			id: d.id,
			name: 'Phone',
			publicKey: d.publicKey
		});

		expect(tp).toMatchObject({
			id: d.id,
			name: "Anna's phone", // This device's own label stays.
			announcedName: 'Phone',
			readOnly: true,
			addedBy: 'intro',
			trustedAt: 'then',
			legacyIds: [UUID]
		});
		expect(tp?.fingerprint).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
		expect((await db.peers.toArray()).map((p) => p.id)).toEqual([d.id]);
		const rows = await db.peerSyncBaseline.toArray();
		expect(rows.map((r) => r.endpointId).sort()).toEqual([d.id, 'other'].sort());
	});

	it('does nothing for a record that is not there', async () => {
		const d = await switched();
		expect(
			await replaceTrustedRecord('missing', { id: d.id, name: 'x', publicKey: d.publicKey })
		).toBeNull();
	});
});

describe('hello of a switched device', () => {
	it('is verified, and reports a rekey for a record under the old ID with the same key', async () => {
		const d = await switched();
		const hello = await buildHello({ id: d.id, name: 'Phone', previousId: UUID }, d, FPS_A);
		const assessed = await assessHello(hello, FPS_B, [record(UUID, { publicKey: d.publicKey })]);
		expect(assessed).toMatchObject({
			verified: true,
			isTrusted: false,
			migration: { kind: 'rekey', from: UUID }
		});
	});

	it('is trusted once its record is under the new ID', async () => {
		const d = await switched();
		const hello = await buildHello({ id: d.id, name: 'Phone' }, d, FPS_A);
		const assessed = await assessHello(hello, FPS_B, [record(d.id, { publicKey: d.publicKey })]);
		expect(assessed).toMatchObject({ verified: true, isTrusted: true });
		expect(assessed.migration).toBeUndefined();
	});

	it('asks for approval for a key-less record that the signed hello names', async () => {
		const d = await switched();
		const hello = await buildHello({ id: d.id, name: 'Phone', previousId: UUID }, d, FPS_A);
		const assessed = await assessHello(hello, FPS_B, [record(UUID)]);
		expect(assessed).toMatchObject({
			isTrusted: false,
			migration: { kind: 'approve', from: UUID }
		});
	});

	it('does not accept a previous ID that was added after signing', async () => {
		const d = await switched();
		const hello = await buildHello({ id: d.id, name: 'Phone' }, d, FPS_A);
		const assessed = await assessHello({ ...hello, previousId: UUID }, FPS_B, [record(UUID)]);
		expect(assessed.verified).toBe(false);
	});

	it('is unverified when the key-derived ID is not the hash of its key', async () => {
		const real = await switched();
		const liar = await switched();
		// The liar signs a valid hello, but claims the real device's ID.
		const hello = await buildHello({ id: real.id, name: 'Phone' }, liar, FPS_A);
		expect(await assessHello(hello, FPS_B, [])).toMatchObject({ verified: false });
	});

	it('still verifies a hello signed before the previous-ID field existed', async () => {
		const d = await switched();
		const sig = await signHello(d.privateKey, {
			id: UUID,
			name: 'Phone',
			signerFp: FPS_A.local,
			receiverFp: FPS_A.remote
		});
		const hello = { id: UUID, name: 'Phone', publicKey: d.publicKey, sig };
		expect(await assessHello(hello, FPS_B, [])).toMatchObject({ verified: true });
	});
});

describe('bucket trust', () => {
	it('merges what a switched device wrote under its legacy ID, as long as it is trusted', async () => {
		await db.peers.put(record('newid', { legacyIds: [UUID] }));
		await db.peers.put(record('ro', { readOnly: true, legacyIds: ['old-ro'] }));
		const ignore = await loadIgnoreReasons();
		expect(ignore('newid')).toBeNull();
		expect(ignore(UUID)).toBeNull();
		expect(ignore('old-ro')).toBe('Device is read-only');
		expect(ignore('stranger')).toBe('Device not trusted');
	});

	it('stores the key of a device found in a bucket, if it belongs to its ID', async () => {
		const d = await switched();
		const tp = await trustDevice(d.id, 'Tablet', d.publicKey);
		expect(tp).toMatchObject({ id: d.id, publicKey: d.publicKey });
		expect(tp.fingerprint).toBeTruthy();
		const other = await switched();
		await expect(trustDevice(d.id, 'x', other.publicKey)).rejects.toThrow(/does not belong/);
	});
});
