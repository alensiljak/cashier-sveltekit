/**
 * What the S3 sync page shows for each item, derived from the comparison with the bucket:
 * which actions are possible, the badge, the description. Pure, so it can be tested without
 * a bucket. The comparison itself comes from s3FileCompare.ts and s3CrdtSync.ts.
 */
import type { CrdtSyncStatus } from './s3CrdtSync';
import type { FileSyncOverview } from './s3FileCompare';
import type { RemoteItemStatus, RemoteOverview } from './s3Status';
import type { SyncLine } from './s3Session';

/** The result of comparing this device with the bucket; null while unknown (or no passphrase). */
export interface CompareStatus {
	fileStatus: FileSyncOverview | null;
	crdtStatus: Record<'scheduled' | 'xacts', CrdtSyncStatus> | null;
}

export type ItemKey = keyof RemoteOverview;

const isFileItem = (key: ItemKey): key is 'settings' | 'beancount' =>
	key === 'settings' || key === 'beancount';

/** True when the bucket holds newer data for this item that an upload could overwrite. */
export function hasNewerRemote(status: CompareStatus, key: ItemKey): boolean {
	if (isFileItem(key)) {
		const s = status.fileStatus?.[key];
		return !!s && (s.download > 0 || s.conflict > 0);
	}
	// CRDT stores merge on download and each device uploads only its own file: nothing to overwrite.
	return false;
}

/** What the row's buttons may do, from the comparison with the bucket. All false while unknown. */
export function actionsFor(
	status: CompareStatus,
	key: ItemKey
): { up: boolean; down: boolean; conflict: boolean } {
	if (isFileItem(key)) {
		const s = status.fileStatus?.[key];
		return { up: !!s?.upload, down: !!s?.download, conflict: !!s?.conflict };
	}
	const s = status.crdtStatus?.[key];
	return { up: !!s?.upload, down: !!s?.download, conflict: false };
}

/** Devices whose next delta is missing from the bucket, for the CRDT rows. */
export function gapsFor(status: CompareStatus, key: ItemKey): CrdtSyncStatus['gaps'] {
	return isFileItem(key) ? [] : (status.crdtStatus?.[key]?.gaps ?? []);
}

export type BadgeKind = 'up' | 'down' | 'conflict' | 'ok';
export type Badge = { text: string; cls: string; kinds: BadgeKind[]; count?: string };

/** What a sync of this item would do, or null when it is unknown. */
export function badgeFor(status: CompareStatus, key: ItemKey): Badge | null {
	if (isFileItem(key)) {
		const s = status.fileStatus?.[key];
		if (!s) return null;
		const n = (count: number) => (key === 'beancount' ? ' (' + count + ')' : '');
		if (s.conflict) {
			return {
				text: 'Conflict' + n(s.conflict),
				cls: 'badge-error',
				kinds: ['conflict'],
				count: n(s.conflict)
			};
		}
		if (s.upload && s.download) {
			return {
				text: 'Upload' + n(s.upload) + ' / Download' + n(s.download),
				cls: 'badge-warning',
				kinds: ['up', 'down']
			};
		}
		if (s.upload) {
			return {
				text: 'Upload needed' + n(s.upload),
				cls: 'badge-warning',
				kinds: ['up'],
				count: n(s.upload)
			};
		}
		if (s.download) {
			return {
				text: 'Download available' + n(s.download),
				cls: 'badge-warning',
				kinds: ['down'],
				count: n(s.download)
			};
		}
		return { text: 'In sync', cls: 'badge-success', kinds: ['ok'] };
	}
	// CRDT stores: compared by their Yjs state, so each item is judged on its own.
	const s = status.crdtStatus?.[key];
	if (!s) return null;
	if (s.upload && s.download)
		return { text: 'Upload / Download', cls: 'badge-warning', kinds: ['up', 'down'] };
	if (s.upload) return { text: 'Upload needed', cls: 'badge-warning', kinds: ['up'] };
	if (s.download) return { text: 'Download available', cls: 'badge-warning', kinds: ['down'] };
	return { text: 'In sync', cls: 'badge-success', kinds: ['ok'] };
}

/** One line on what the bucket holds for the item. */
export function describeItem(item: RemoteItemStatus, key: ItemKey): string {
	if (!item.count) return 'Nothing in the bucket';
	const parts = [item.lastModified ? item.lastModified.toLocaleString() : 'unknown time'];
	if (key === 'beancount') parts.push(`${item.count} ${item.count === 1 ? 'file' : 'files'}`);
	if (item.otherDeviceModified) {
		parts.push(`other devices: ${item.otherDeviceModified.toLocaleString()}`);
	}
	return parts.join(' · ');
}

/** Downloaded data reaches the ledger through the working set and the OPFS files. */
export function touchesLedger(done: SyncLine[]): boolean {
	return done.some(
		(l) =>
			(l.outcome === 'downloaded' && (l.item === 'xacts' || l.item === 'beancount')) ||
			(l.outcome === 'deleted' && l.item === 'beancount')
	);
}

/** True when a run ended with nothing left for the user to decide or fix. */
export function isCleanRun(lines: SyncLine[]): boolean {
	return !lines.some(
		(l) => l.outcome === 'conflict' || l.outcome === 'error' || l.outcome === 'pending-delete'
	);
}
