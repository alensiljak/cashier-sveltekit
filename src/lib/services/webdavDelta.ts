/**
 * The working set and the scheduled transactions on WebDAV, as delta sync (see
 * sync/deltaSync.ts): upload, check, merge, compact, and the devices found in the folder. The
 * folder holds the same flat objects as the S3 bucket, with file names `cashier-<kind>-<name>`.
 *
 * A background action must not create the scheduled-transactions store, which would pre-empt its
 * first-launch migration prompt (see webdavAutoBackupService), so it is skipped while it does not
 * exist here.
 */
import db from '#lib/data/db';
import { getXactStore } from '#lib/storage/xactStoreRegistry';
import { getScxStore } from '#lib/storage/scxStoreRegistry';
import { getDeviceId, type DocKind } from '#lib/sync/ydocDevices';
import {
	parseKey,
	type CompactResult,
	type DeltaSync,
	type DownloadResult
} from '#lib/sync/deltaSync';
import { afterSync, getDeltaSync, loadTrusted, webDavRemoteId } from '#lib/sync/deltaSyncRegistry';
import type { WebDavClient } from '#lib/utils/webdav';
import { remoteFor } from './webdavEncryption';
import { WebDavRemoteStore } from './webdavRemoteStore';

export const ALL_KINDS: DocKind[] = ['xacts', 'scx'];

const storeOf = (kind: DocKind) => (kind === 'xacts' ? getXactStore() : getScxStore());

/** The working set always exists; scheduled transactions only once they were set up here. */
async function usable(kind: DocKind): Promise<boolean> {
	return kind === 'xacts' || (await getScxStore()).isInitialized();
}

async function syncFor(client: WebDavClient, kind: DocKind): Promise<DeltaSync> {
	return getDeltaSync({
		kind,
		deviceId: await getDeviceId(),
		store: await storeOf(kind),
		// Encrypted as configured; refuses (EncryptionMismatchError) when the folder disagrees.
		remote: await remoteFor(client),
		remoteId: webDavRemoteId(client.fileUrl(''))
	});
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What went wrong in a download, as messages. */
function problemsOf(kind: DocKind, r: DownloadResult): string[] {
	return [
		...r.errors.map((e) => `${e.key}: ${e.message}`),
		...r.invalid
			.slice(0, 5)
			.map((bad) => `${kind}: record ${bad.id} that came in is not valid (${bad.reason})`),
		...r.gaps.map(
			(g) =>
				`${kind}: delta ${g.expected} of ${g.deviceId} is missing; later changes are not merged yet`
		)
	];
}

/**
 * Uploads what changed since the last upload, then tells the others what this device has applied
 * and compacts when it is time. Resolves to the error messages (empty on success).
 */
export async function uploadCrdtState(
	client: WebDavClient,
	kinds: DocKind[] = ALL_KINDS
): Promise<string[]> {
	const errors: string[] = [];
	for (const kind of kinds) {
		try {
			if (!(await usable(kind))) continue;
			const sync = await syncFor(client, kind);
			await sync.upload();
			await afterSync(sync, { compact: true });
		} catch (e) {
			errors.push(errorText(e));
		}
	}
	return errors;
}

/** True when the folder and this device differ: changes to merge here, or changes it lacks. Lists only. */
export async function checkWebDav(client: WebDavClient): Promise<boolean> {
	for (const kind of ALL_KINDS) {
		if (!(await usable(kind))) continue;
		const { upload, download } = await (await syncFor(client, kind)).status();
		if (upload || download) return true;
	}
	return false;
}

/** Merges what the trusted devices uploaded, for the given kinds. `records` are the store's reports of what changed. */
export async function mergeWebDav(
	client: WebDavClient,
	kinds: DocKind[] = ALL_KINDS
): Promise<Partial<Record<DocKind, DownloadResult>>> {
	const results: Partial<Record<DocKind, DownloadResult>> = {};
	for (const kind of kinds) {
		if (!(await usable(kind))) continue;
		const sync = await syncFor(client, kind);
		results[kind] = await sync.download();
		await afterSync(sync, { compact: false });
	}
	return results;
}

/**
 * Merges the other devices' changes, then uploads this device's. Returns the error messages and
 * whether working-set records were merged in (the ledger then needs a reload).
 */
export async function syncWebDav(
	client: WebDavClient
): Promise<{ errors: string[]; merged: boolean }> {
	const errors: string[] = [];
	let merged = false;
	for (const kind of ALL_KINDS) {
		try {
			if (!(await usable(kind))) continue;
			const sync = await syncFor(client, kind);
			const r = await sync.download();
			errors.push(...problemsOf(kind, r));
			if (kind === 'xacts' && r.changes > 0) merged = true;
			await sync.upload();
			await afterSync(sync, { compact: true });
		} catch (e) {
			errors.push(errorText(e));
		}
	}
	return { errors, merged };
}

/** Compacts now, whether or not it is time. Resolves to what each store did. */
export async function compactWebDavNow(
	client: WebDavClient
): Promise<Partial<Record<DocKind, CompactResult | null>>> {
	const results: Partial<Record<DocKind, CompactResult | null>> = {};
	const isActive = await loadTrusted();
	for (const kind of ALL_KINDS) {
		if (!(await usable(kind))) continue;
		results[kind] = await (await syncFor(client, kind)).compactIfDue({ isActive, force: true });
	}
	return results;
}

export interface WebDavDevice {
	deviceId: string;
	status: 'self' | 'trusted' | 'untrusted';
	/** Name from the Trusted Devices list, when trusted. */
	name?: string;
	/** Trusted but read-only: its data is never merged here. */
	readOnly?: boolean;
	/** Newest change it uploaded. */
	lastModified: Date | null;
	/** Objects it has in the folder (deltas and legacy files). */
	objects: number;
}

/** The devices that have uploaded to the folder, each classified against the trusted devices. */
export async function listWebDavDevices(client: WebDavClient): Promise<WebDavDevice[]> {
	const [infos, peers, selfId] = await Promise.all([
		new WebDavRemoteStore(client).list('crdt/'),
		db.peers.toArray(),
		getDeviceId()
	]);
	const found = new Map<string, { lastModified: Date | null; objects: number }>();
	for (const info of infos) {
		const kind = /^crdt\/([^/]+)\//.exec(info.key)?.[1] as DocKind;
		const parsed = parseKey(kind, info.key);
		if (!parsed || parsed.type === 'snapshot') continue;
		const entry = found.get(parsed.deviceId) ?? { lastModified: null, objects: 0 };
		if (parsed.type !== 'ack') {
			entry.objects++;
			if (info.lastModified && (!entry.lastModified || info.lastModified > entry.lastModified)) {
				entry.lastModified = info.lastModified;
			}
		}
		found.set(parsed.deviceId, entry);
	}
	return [...found]
		.map(([deviceId, { lastModified, objects }]) => {
			const peer = peers.find((p) => p.id === deviceId);
			return {
				deviceId,
				status:
					deviceId === selfId
						? ('self' as const)
						: peer
							? ('trusted' as const)
							: ('untrusted' as const),
				name: peer?.name,
				readOnly: peer?.readOnly,
				lastModified,
				objects
			};
		})
		.sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

/**
 * Removes everything a device uploaded: merges it first if it is trusted, so no other device
 * loses a change that only its deltas held, and publishes that in a snapshot. Returns how many
 * files were deleted.
 */
export async function forgetWebDavDevice(
	client: WebDavClient,
	deviceId: string
): Promise<{ deleted: number }> {
	let deleted = 0;
	for (const kind of ALL_KINDS) {
		if (!(await usable(kind))) continue;
		deleted += (await (await syncFor(client, kind)).forget(deviceId)).deleted;
	}
	return { deleted };
}

/** When each store was last changed in the folder, from one listing. */
export async function webDavModified(client: WebDavClient): Promise<Record<DocKind, Date | null>> {
	const out: Record<DocKind, Date | null> = { xacts: null, scx: null };
	for (const info of await new WebDavRemoteStore(client).list('crdt/')) {
		const kind = /^crdt\/([^/]+)\//.exec(info.key)?.[1] as DocKind;
		if (kind !== 'xacts' && kind !== 'scx') continue;
		if (parseKey(kind, info.key)?.type === 'ack') continue;
		if (info.lastModified && (!out[kind] || info.lastModified > out[kind]!)) {
			out[kind] = info.lastModified;
		}
	}
	return out;
}
