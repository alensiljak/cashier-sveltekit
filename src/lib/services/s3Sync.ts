/**
 * Manual sync of the app's data with an S3 bucket. See doc/projects/2026-10-05_s3-sync.md.
 *
 * Bucket layout (every object except key.json is encrypted, see s3Crypto.ts):
 * - key.json                  key-derivation parameters, shared by all devices
 * - manifests/<deviceId>.json what each device last uploaded (path -> hash, time)
 * - data/settings.json        shared settings
 * - data/files/<path>         Beancount files, by their OPFS path
 * - crdt/<xacts|scx>/snap-<ulid>.ydoc, crdt/<xacts|scx>/<deviceId>.<seq>.upd
 *                             the CRDT stores as a snapshot plus per-device deltas (see
 *                             sync/deltaSync.ts). Merged on download, so they never conflict.
 *                             The older crdt/<kind>/<deviceId>.ydoc files are still read.
 *
 * Settings and files can be changed on several devices. They are compared by content hash
 * against the last-synced hash, and a change on both sides is reported as a conflict to be
 * resolved by the user, never overwritten silently.
 *
 * The implementation is split by concern; this module re-exports the public surface:
 * - s3Session.ts      session, keys, manifests, last-sync bookkeeping
 * - s3Files.ts        settings and Beancount files, runSync, conflicts, deletions
 * - s3CrdtSync.ts     CRDT stores: sync, status, previews, diagnostics, compaction
 * - s3FileCompare.ts  per-file status and comparison
 * - s3Status.ts       bucket overview and other devices
 * - s3Preview.ts      readable bucket objects
 */
export {
	getLastSync,
	getSyncKey,
	openSession,
	persistSession,
	type S3Session,
	type SyncItem,
	type SyncLine,
	type SyncOutcome
} from './s3Session';
export { applyDeletion, applyMerge, resolveConflict, runSync } from './s3Files';
export {
	backupCrdtStores,
	checkCrdtStores,
	compactBucketNow,
	diagnoseCrdt,
	fetchCrdtSyncStatus,
	forgetBucketDevice,
	previewCrdtChanges,
	syncCrdtStores,
	type CrdtChangePreview,
	type CrdtDiagnosticFile,
	type CrdtDiagnostics,
	type CrdtDownloadPreview,
	type CrdtRecord,
	type CrdtSyncStatus
} from './s3CrdtSync';
export {
	compareFile,
	compareSettings,
	fetchFileSyncStatus,
	listFileStatuses,
	markSameContent,
	type FileComparison,
	type FileState,
	type FileStatusEntry,
	type FileSyncOverview,
	type FileSyncStatus
} from './s3FileCompare';
export {
	fetchRemoteOverview,
	listBucketDevices,
	type BucketDevice,
	type RemoteItemStatus,
	type RemoteOverview
} from './s3Status';
export { previewObject } from './s3Preview';
