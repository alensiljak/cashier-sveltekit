/**
 * The CRDT stores (transactions, scheduled transactions) in the bucket: delta sync, status,
 * dry-run previews, diagnostics, compaction and forgetting a device. Merged on download, so
 * they never conflict. See sync/deltaSync.ts.
 */
import * as Y from 'yjs';
import db from '#lib/data/db';
import { getDeviceId, type DocKind } from '#lib/sync/ydocDevices';
import {
	DeltaSync,
	type CompactResult,
	type DeltaGap,
	deltaKey,
	deviceDeltaPrefix,
	deviceOfKey,
	kindPrefix,
	vectorOf
} from '#lib/sync/deltaSync';
import {
	afterSync,
	getDeltaSync,
	loadIgnoreReasons,
	loadTrusted,
	s3RemoteId
} from '#lib/sync/deltaSyncRegistry';
import { getXactStore } from '#lib/storage/xactStoreRegistry';
import { getScxStore } from '#lib/storage/scxStoreRegistry';
import { hasRetiredOps, readUpdateMeta, type RecordChange } from '#lib/storage/crdtDocStore';
import type { XactRecord } from '#lib/storage/crdtXactRecord';
import type { ScxRecord } from '#lib/storage/crdtScxRecord';
import { announceDevice, loadBucketSigning } from '#lib/sync/deviceRecords';
import { syncBucketRevocations } from '#lib/sync/revocations';
import { peerOf } from '#lib/sync/identityMigration';
import type { S3Config } from './s3Config';
import { deleteObject } from './s3Client';
import { S3RemoteStore } from './s3RemoteStore';
import {
	errorText,
	getSyncKey,
	manifestKey,
	recordLastSync,
	type S3Session,
	type SyncLine
} from './s3Session';
import type { SyncDirection } from './s3SyncPlan';
// --- CRDT stores (transactions, scheduled transactions) ---

/**
 * The device that wrote a CRDT object (`crdt/<kind>/<deviceId>.<seq>.upd`, or the legacy
 * `crdt/<kind>/<deviceId>.ydoc`), or null for a snapshot and anything else.
 */
export const deviceIdOfKey = (objectKey: string): string | null => {
	const kind = /^crdt\/([^/]+)\//.exec(objectKey)?.[1];
	return kind === 'xacts' || kind === 'scx' ? deviceOfKey(kind, objectKey) : null;
};

const kindOf = (item: 'xacts' | 'scheduled'): DocKind => (item === 'xacts' ? 'xacts' : 'scx');

type CrdtSession = Pick<S3Session, 'cfg' | 'key' | 'deviceId'>;

const storeOf = (item: 'xacts' | 'scheduled') =>
	item === 'xacts' ? getXactStore() : getScxStore();

/**
 * The delta sync of a store for this bucket, attached to the store's changes so that what is
 * edited meanwhile is captured for upload.
 */
async function deltaSyncFor(s: CrdtSession, item: 'xacts' | 'scheduled'): Promise<DeltaSync> {
	const { ctx, directory } = await loadBucketSigning();
	const remote = new S3RemoteStore(s.cfg, s.key, ctx);
	directory.bind(remote);
	await announceDevice(s3RemoteId(s.cfg), remote);
	await syncBucketRevocations(s3RemoteId(s.cfg), remote, s.deviceId);
	return getDeltaSync({
		kind: kindOf(item),
		deviceId: s.deviceId,
		store: await storeOf(item),
		remote,
		remoteId: s3RemoteId(s.cfg)
	});
}

export async function syncCrdt(
	s: CrdtSession,
	direction: SyncDirection,
	item: 'xacts' | 'scheduled'
): Promise<SyncLine[]> {
	const kind = kindOf(item);
	const prefix = kindPrefix(kind);
	const lines: SyncLine[] = [];

	try {
		if (direction === 'upload') {
			// A background action must not create the scheduled-transactions store: that would
			// pre-empt its first-launch migration prompt (see webdavAutoBackupService).
			if (item === 'scheduled' && !(await (await storeOf(item)).isInitialized())) {
				return [{ item, path: prefix, outcome: 'skipped', message: 'Not set up on this device' }];
			}
			const sync = await deltaSyncFor(s, item);
			const { seq } = await sync.upload();
			await afterSync(sync, { compact: true });
			return [
				seq === null
					? { item, path: prefix, outcome: 'unchanged' }
					: { item, path: deltaKey(kind, s.deviceId, seq), outcome: 'uploaded' }
			];
		}

		const sync = await deltaSyncFor(s, item);
		const r = await sync.download();
		await afterSync(sync, { compact: false });
		if (r.declined) {
			return [
				{
					item,
					path: prefix,
					outcome: 'skipped',
					message:
						'Another device reset the store; not applied, as you chose to wait. You will be asked again at the next sync.'
				}
			];
		}
		if (!r.foreign) {
			return [
				{ item, path: prefix, outcome: 'skipped', message: 'No other device has uploaded yet' }
			];
		}
		for (const { deviceId, reason } of r.skipped) {
			lines.push({
				item,
				path: deviceDeltaPrefix(kind, deviceId),
				outcome: 'skipped',
				message: reason
			});
		}
		for (const g of r.gaps) {
			lines.push({
				item,
				path: deltaKey(kind, g.deviceId, g.expected),
				outcome: 'error',
				message: `Missing from the bucket (the next one found is ${g.found}); changes after it are not merged yet`
			});
		}
		for (const e of r.errors) {
			lines.push({ item, path: e.key, outcome: 'error', message: e.message });
		}
		for (const bad of r.invalid.slice(0, 5)) {
			lines.push({
				item,
				path: `${prefix}${bad.id}`,
				outcome: 'error',
				message: `A record that came in is not valid (${bad.reason}); check it in the journal`
			});
		}
		// The bucket already holds what it returned: it is not uploaded again as our own.
		const applied = r.snapshot || r.deltas > 0 || r.legacy > 0;
		if (applied || !lines.length) {
			lines.push({
				item,
				path: prefix,
				outcome: r.changes ? 'downloaded' : 'unchanged',
				message: r.changes ? `${r.changes} changes merged` : undefined
			});
		}
	} catch (e) {
		lines.push({ item, path: prefix, outcome: 'error', message: errorText(e) });
	}
	return lines;
}

/**
 * Uploads this device's CRDT state (transactions, scheduled transactions) for the automatic
 * backup. Needs only the key, not the manifests, and never conflicts: each device owns its file.
 * Resolves to the lines that failed (empty on success).
 */
export async function backupCrdtStores(
	cfg: S3Config,
	kinds: DocKind[] = ['xacts', 'scx']
): Promise<SyncLine[]> {
	const session = await crdtSession(cfg);
	const lines: SyncLine[] = [];
	if (kinds.includes('xacts')) lines.push(...(await syncCrdt(session, 'upload', 'xacts')));
	if (kinds.includes('scx')) lines.push(...(await syncCrdt(session, 'upload', 'scheduled')));
	return lines.filter((l) => l.outcome === 'error');
}

/**
 * True when the bucket and this device differ in a CRDT store: another device has changes not
 * merged here, or this device has changes the bucket lacks.
 */
async function crdtDiffers(s: CrdtSession, item: 'xacts' | 'scheduled'): Promise<boolean> {
	const { upload, download } = await crdtStatus(s, item);
	return upload || download;
}

/**
 * Compares a CRDT store with the bucket by record changes: `upload` = this device has changes
 * the bucket lacks; `download` = a trusted device (or a snapshot) has changes that a merge would
 * make here. What changes no record is applied on the spot (see `DeltaSync.review`), so this
 * can write bookkeeping state, never data.
 */
async function crdtStatus(s: CrdtSession, item: 'xacts' | 'scheduled'): Promise<CrdtSyncStatus> {
	if (item === 'scheduled' && !(await (await storeOf(item)).isInitialized())) {
		return { upload: false, download: false, gaps: [] };
	}
	const { upload, download, gaps } = await (await deltaSyncFor(s, item)).review();
	return { upload, download, gaps };
}

export interface CrdtSyncStatus {
	upload: boolean;
	download: boolean;
	/** Devices whose next delta is missing from the bucket, so what follows cannot be applied. */
	gaps: DeltaGap[];
}

/** Compares the CRDT stores with the bucket, per item. Needs the passphrase: it reads the new objects. */
export async function fetchCrdtSyncStatus(
	cfg: S3Config
): Promise<Record<'scheduled' | 'xacts', CrdtSyncStatus>> {
	const s = await crdtSession(cfg);
	return {
		scheduled: await crdtStatus(s, 'scheduled'),
		xacts: await crdtStatus(s, 'xacts')
	};
}

export type CrdtRecord = XactRecord | ScxRecord;

export interface CrdtDownloadPreview {
	deviceId: string | null;
	/** Name from the Trusted Devices list. */
	name?: string;
	key: string;
	/** What merging this device's file would change here, on top of the devices listed before it. */
	changes: RecordChange<CrdtRecord>[];
	/** Why the file would not be merged: the device is not trusted, or is read-only. */
	ignored?: string;
}

export interface CrdtChangePreview {
	/** Records a download would add, change or delete on this device. */
	download: CrdtDownloadPreview[];
	/** Records an upload would add, change or delete for the other devices' merged view. */
	upload: RecordChange<CrdtRecord>[];
}

/**
 * Dry run of a CRDT store sync, down to the single records, so the user can see what a merge
 * would do before accepting either direction. Reads the bucket, writes nothing anywhere.
 * Needs the passphrase.
 */
export async function previewCrdtChanges(
	cfg: S3Config,
	item: 'xacts' | 'scheduled'
): Promise<CrdtChangePreview> {
	const s = await crdtSession(cfg);
	const store = await storeOf(item);
	if (item === 'scheduled' && !(await store.isInitialized())) return { download: [], upload: [] };

	const sync = await deltaSyncFor(s, item);
	const [ignoreReason, peers] = await Promise.all([loadIgnoreReasons(), db.peers.toArray()]);
	const files: CrdtDownloadPreview[] = [];

	// Devices whose data is not merged here: one line each.
	const ignoredSeen = new Set<string>();
	for (const o of await sync.objects()) {
		const reason = o.deviceId && o.deviceId !== s.deviceId ? ignoreReason(o.deviceId) : null;
		if (reason && !ignoredSeen.has(o.deviceId!)) {
			ignoredSeen.add(o.deviceId!);
			files.push({ deviceId: o.deviceId, key: o.key, changes: [], ignored: reason });
		}
	}

	// What a download would apply, one object after the other.
	const unapplied = await sync.read({ unappliedOnly: true });
	const results = await store.previewImport(unapplied.map((u) => u.update));
	unapplied.forEach(({ object }, i) =>
		files.push({
			deviceId: object.deviceId,
			name: peerOf(peers, object.deviceId)?.name,
			key: object.key,
			changes: results[i]
		})
	);

	// What an upload would change in the view the other devices build from the bucket.
	const bucket = await sync.read({ unappliedOnly: false });
	return {
		download: files,
		upload: await store.previewExportOnto(bucket.map((b) => b.update))
	};
}

export interface CrdtDiagnosticFile {
	key: string;
	own: boolean;
	name?: string;
	ignored?: string;
	/** Clients whose clock in this file is ahead of this device's: what makes the check say "download". */
	ahead: { client: number; theirs: number; ours: number }[];
	/** The file holds operations from before this device's last reset, which a merge skips. */
	retiredOps: boolean;
	/** The structs that make it `retiredOps`: this device's retired clock for the client is above theirs. */
	retiredHits: { client: number; clock: number; limit: number; kind: string }[];
	resetId: string;
	/** Clients with operations in this file, and how many of those structs a merge would apply. */
	structCount: number;
}

export interface CrdtDiagnostics {
	localResetId: string;
	localClients: number;
	files: CrdtDiagnosticFile[];
	/** Clients whose local clock is ahead of everything in the bucket: what makes the check say "upload". */
	uploadAhead: { client: number; ours: number; bucket: number }[];
}

/** Explains the "download" / "upload" verdict of the state-vector check, file by file. */
export async function diagnoseCrdt(
	cfg: S3Config,
	item: 'xacts' | 'scheduled'
): Promise<CrdtDiagnostics> {
	const s = await crdtSession(cfg);
	const store = await storeOf(item);
	const sync = await deltaSyncFor(s, item);
	const local = await store.exportState();
	const ours = vectorOf(local);
	const localMeta = readUpdateMeta(local);

	const [ignoreReason, peers] = await Promise.all([loadIgnoreReasons(), db.peers.toArray()]);
	const files: CrdtDiagnosticFile[] = [];
	const bucket = new Map<number, number>();
	for (const { object, update } of await sync.read({
		unappliedOnly: false,
		includeIgnored: true
	})) {
		const own = object.deviceId === s.deviceId;
		const ignored = !own && object.deviceId ? ignoreReason(object.deviceId) : null;
		const theirs = vectorOf(update);
		if (!ignored) {
			for (const [client, clock] of theirs) {
				bucket.set(client, Math.max(bucket.get(client) ?? 0, clock));
			}
		}
		files.push({
			key: object.key,
			own,
			name: peerOf(peers, object.deviceId)?.name,
			ignored: ignored ?? undefined,
			ahead: [...theirs]
				.filter(([client, clock]) => clock > (ours.get(client) ?? 0))
				.map(([client, clock]) => ({ client, theirs: clock, ours: ours.get(client) ?? 0 })),
			retiredOps: hasRetiredOps(update, localMeta.retired),
			retiredHits: Y.decodeUpdate(update)
				.structs.flatMap((st) => {
					const limit = localMeta.retired[st.id.client];
					return limit !== undefined && st.id.clock < limit
						? [{ client: st.id.client, clock: st.id.clock, limit, kind: st.constructor.name }]
						: [];
				})
				.slice(0, 20),
			resetId: readUpdateMeta(update).resetId,
			structCount: Y.decodeUpdate(update).structs.length
		});
	}

	return {
		localResetId: localMeta.resetId,
		localClients: ours.size,
		files,
		uploadAhead: [...ours]
			.filter(([client, clock]) => clock > (bucket.get(client) ?? 0))
			.map(([client, clock]) => ({ client, ours: clock, bucket: bucket.get(client) ?? 0 }))
	};
}

async function crdtSession(cfg: S3Config): Promise<CrdtSession> {
	return { cfg, key: await getSyncKey(cfg), deviceId: await getDeviceId() };
}

/** Compares the CRDT stores with the bucket without changing anything. True = they differ. */
export async function checkCrdtStores(cfg: S3Config): Promise<boolean> {
	const s = await crdtSession(cfg);
	return (await crdtDiffers(s, 'xacts')) || (await crdtDiffers(s, 'scheduled'));
}

/**
 * Full sync of the CRDT stores: merges the other devices' state, then uploads this device's.
 * Returns the failed lines and whether records were merged in (the ledger then needs a reload).
 */
export async function syncCrdtStores(
	cfg: S3Config
): Promise<{ errors: SyncLine[]; merged: boolean }> {
	const s = await crdtSession(cfg);
	const down = [
		...(await syncCrdt(s, 'download', 'xacts')),
		...(await syncCrdt(s, 'download', 'scheduled'))
	];
	const up = [
		...(await syncCrdt(s, 'upload', 'xacts')),
		...(await syncCrdt(s, 'upload', 'scheduled'))
	];
	const errors = [...down, ...up].filter((l) => l.outcome === 'error');
	if (!errors.length) await recordLastSync();
	return {
		errors,
		merged: down.some((l) => l.outcome === 'downloaded' && l.item === 'xacts')
	};
}

/**
 * Compacts the CRDT stores now, whether or not it is time: folds the uploaded changes into a
 * snapshot and deletes what that makes unnecessary. Resolves to what each store did; a store
 * that was not set up here is left out.
 */
export async function compactBucketNow(
	cfg: S3Config
): Promise<Partial<Record<DocKind, CompactResult | null>>> {
	const s = await crdtSession(cfg);
	const isActive = await loadTrusted();
	const results: Partial<Record<DocKind, CompactResult | null>> = {};
	for (const item of ['xacts', 'scheduled'] as const) {
		if (item === 'scheduled' && !(await (await storeOf(item)).isInitialized())) continue;
		results[kindOf(item)] = await (
			await deltaSyncFor(s, item)
		).compactIfDue({
			isActive,
			force: true
		});
	}
	return results;
}

/**
 * Removes everything a device wrote to the bucket: its deltas, its legacy state files and its
 * manifest. Call it while the device is still trusted. What it wrote is merged here first and
 * published in a snapshot, so no other device loses a change that only its deltas held. Stops
 * with an error, deleting nothing for that store, when something could not be merged.
 */
export async function forgetBucketDevice(
	cfg: S3Config,
	deviceId: string
): Promise<{ deleted: number }> {
	const s = await crdtSession(cfg);
	let deleted = 0;
	for (const item of ['xacts', 'scheduled'] as const) {
		// A store this device never set up has nothing here to merge the other device's data into.
		if (item === 'scheduled' && !(await (await storeOf(item)).isInitialized())) continue;
		deleted += (await (await deltaSyncFor(s, item)).forget(deviceId)).deleted;
	}
	await deleteObject(cfg, manifestKey(deviceId));
	return { deleted };
}
