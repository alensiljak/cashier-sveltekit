# Delta Sync via Remote Storage

## Goal

The goal is to keep the CRDT exchange, when synchronized via remote storage (not directly via p2p), to a minimum by exchanging only deltas, not the whole yjs document.
As the document grows over time, this saves a lot of network traffic.

## Current behaviour (analysis)

Code: `s3Sync.ts` (`syncCrdt`, `crdtStatus`, `previewCrdtChanges`, `diagnoseCrdt`), `webdavSync.ts`, `webdavAutoBackupService.ts`, `crdtDocStore.ts`, `ydocDevices.ts`.

- Each device owns one full-state file per store: `crdt/<xacts|scx>/<deviceId>.ydoc` (S3, encrypted) and `cashier-<kind>-<deviceId>.ydoc` (WebDAV, plain).
- **Upload**: after every write, `scheduleBackup()` (2 s debounce) PUTs `Y.encodeStateAsUpdate(doc)`, the whole document. Cost per change = full doc size.
- **Download**: every other trusted device's full file is fetched and applied with `importState` (idempotent merge). S3 has no "changed since" test, so all files are fetched every time.
- **Status check** (`crdtStatus`, `checkCrdtStores`, S3 dry-run, WebDAV `checkWebDav`) fetches and decrypts _all_ files to compare state vectors. This is probably the largest waste: it is paid on every check, even when nothing changed.
- WebDAV decides "needs merge" by file `lastModified`; S3 by state vectors.
- No clean-up is needed today, because files are overwritten in place.
- `reset()` already purges history (tombstones) and marks the new doc with `resetId` + `retired` state vector; `importState` adopts a newer reset and refuses retired ops.
- `importState` already copes with incremental updates: `readUpdateMeta` of a delta has an empty `resetId`, so only the `hasRetiredOps` check applies.
- The peer (WebRTC) sync already uses state-vector diffs (`mergeAndDiff`, `diffOnly`). Delta sync via storage is the same idea over a dumb store.

## Research

- [x] check if yjs can upload only deltas on sync — **yes**.
  - `Y.encodeStateAsUpdate(doc, remoteStateVector)` yields only what the other side lacks.
  - `doc.on('update', (u, origin))` yields one incremental update per transaction.
  - Updates are commutative and idempotent; `Y.mergeUpdates` / `Y.diffUpdate` work without a doc. Out-of-order or duplicate application is safe (Yjs holds back structs whose dependencies are missing).
  - **Caveat**: `encodeStateAsUpdate(doc, sv)` always carries the _whole_ delete set. Transactions are deleted often, so the delete set only grows, and every state-vector-diff delta would carry it. Per-transaction `update` events contain only that transaction's deletions, so deltas are built from those (see Writer).
- Tombstones are not removed by a snapshot: Yjs frees the content of deleted records but keeps their ids and the delete set (run-length encoded). They live on in the snapshot and grow slowly. Only `reset()` (new generation) clears them. Deltas stay small; the snapshot grows slowly.
- Sizes: the design does not depend on them. The status check downloads every file today, so listing-based status pays off even for small docs. Real sizes can be read from the S3 explorer (`crdt/<kind>/`) at any time.

## Design

One shared snapshot per store, plus per-device delta files. Assumes a single user, so two devices compacting at the very same moment is rare; it is still made harmless (see Compaction).

### Principles

1. Deltas are written only by their own device, under its own prefix, and never overwritten. Snapshots are written under unique names and never overwritten. So there are no write conflicts.
2. Updates are idempotent and commutative, so correctness never depends on an object being present: a missing delta is replaced by a snapshot that covers it.
3. Any device may compact (write a snapshot and delete what it covers). Deleting covered objects is safe from any device.

### Layout (replaces `<deviceId>.ydoc`)

```text
crdt/<kind>/snap-<ulid>.ydoc          full state of the doc + coverage map {deviceId: seq, ...}
crdt/<kind>/<deviceId>/d-<seq>.upd    delta; seq = 000001, 000002, ... (zero-padded, per device)
```

The coverage map is stored inside the (encrypted) snapshot object. Readers fetch the snapshot anyway when it is newer than theirs, so the key needs nothing but the ULID.

WebDAV: same names flattened (`cashier-<kind>-snap-<ulid>.ydoc`, `cashier-<kind>-<deviceId>-d-<seq>.upd`) to avoid MKCOL and per-folder PROPFIND.

The legacy `<deviceId>.ydoc` files are read as snapshots with empty coverage, so migration needs no conversion step.

### Writer (upload)

- State kept locally: `nextSeq`, and an **outbox** in IndexedDB (per store) of Yjs updates not yet uploaded.
- Capture: `doc.on('update', (u, origin))` appends `u` to the outbox for local edits (no origin) and for ops merged from WebRTC peers (`REMOTE_ORIGIN`; they are not in the bucket). Not captured: IndexedDB loads, and updates imported from the bucket.
- Origins: today every import uses `REMOTE_ORIGIN`, so a bucket import is indistinguishable from a peer merge. Add `BUCKET_ORIGIN` (`'bucket'`) and let `importState` take the origin as an option; the S3/WebDAV paths pass it. Nothing else depends on it: the peer live sync (`peerConnection.svelte.ts`) forwards only updates with no origin, so it ignores the new one just as it ignores `REMOTE_ORIGIN`.
- On sync: `delta = Y.mergeUpdates(outbox)`. If the outbox is empty, upload nothing. Else PUT `d-<nextSeq>.upd` (encrypted, `onlyIfAbsent`), then clear the sent part of the outbox and bump `nextSeq`. Updates added meanwhile stay in the outbox.
- Crash between PUT and bookkeeping: the next run re-sends the same updates under the same seq (`onlyIfAbsent` says it exists, which is fine since content is idempotent and a re-merge is a superset).
- Self-heal: if the outbox is lost or inconsistent (IndexedDB cleared while the doc survived, `adopt()`, restore), fall back once to `encodeStateAsUpdate(doc, snapshotStateVector)` as the delta. It is bigger (carries the whole delete set) but correct.
- The outbox is cleared on `reset()`; a reset writes a new snapshot (see Reset).

### Reader (download)

- One LIST of `crdt/<kind>/` (keys, sizes, mtimes; no decryption).
- Local per-store state: `snapId` (the snapshot applied) and `applied: {deviceId: seq}`.
- Apply order: newest snapshot if its id differs from `snapId` (then `applied` = its coverage), then every delta with `seq > applied[device]`, per device in seq order. All through the bucket-import origin.
- A gap in a device's seqs, or a 404 on an object just listed, means it was compacted: relist and take the newest snapshot.
- **Status check becomes free**: "download" = the listing has a newer snapshot or seqs beyond `applied`; "upload" = the outbox is not empty. No object is fetched.
- Dry-run preview (`previewCrdtChanges`) fetches only the unapplied objects.

### Compaction

- **Acknowledgements**: after each sync, a device records what it has applied in its own `manifests/<deviceId>.json`: `crdt: { <kind>: { snapId, applied: {deviceId: seq} } }`. It is written only when `applied` changed, one small PUT of an object that exists already. The manifest stays conservative (it can only lag behind reality), which is the safe direction.
- **Trigger** (any device, from the listing alone, no decryption): after a sync in which this device has applied everything, when there are 30 or more delta objects, or the newest snapshot is older than a week and any delta exists. Also a manual "Compact now" in the S3 explorer. Thresholds are constants, to be tuned in practice.
- **Deletable deltas**: a delta is deletable when every _active_ device's manifest shows it applied. Active = the device is on the Trusted Devices list and its manifest was updated within the last 30 days. A longer-absent device is ignored and gets the snapshot when it returns; a device removed from Trusted Devices is ignored at once (see Device trust). The manifests are read (N small GETs) only when the trigger fires, not on every sync.
- **Steps**: sync first, read the manifests. If nothing is deletable, stop. Write `snap-<ulid>.ydoc` = `encodeStateAsUpdate(doc)` with coverage = `applied` plus this device's own `nextSeq - 1`. Then delete the deletable deltas and all but the newest two snapshots. (The snapshot may cover more than is deleted; that is fine, the delta files just wait for their acknowledgements.)
- A device that has not applied a deleted delta can still not exist by design, but if it happens (manifest wrong, device returns after 30 days) it takes the snapshot instead: one full download, nothing is lost.
- Own unsent outbox ops are not covered: they are uploaded later as deltas with the normal next seq, so the snapshot never claims what it lacks.
- Concurrent compaction by two devices: unique ULID names mean no overwrite; both snapshots are valid, the newest wins, the other is deleted later. Deleting after writing, and the reader's 404 fallback, cover the rest.
- A lagging or new device always does the same thing: take the newest snapshot, then the deltas after its coverage.
- Tombstones stay in the snapshot (see Research); `reset()` remains the way to clear them.

### Reset interplay

- `reset()` writes a new snapshot first (it carries the new `resetId`), then deletes all deltas and older snapshots, and clears the outbox. Coverage restarts empty; device seqs continue (never reused).
- Readers apply the snapshot before any later delta, so `importState` adopts the new generation via the existing `resetId` path. Deltas carry no `resetId` and pass only through `hasRetiredOps`.
- Test explicitly: a delta from the old generation arriving after the reset (must be refused as retired); a new-generation delta listed before its snapshot (must wait for the snapshot, never be applied to the old doc).

### Device trust

Deltas are attributable by their folder name, so the existing Trusted Devices check (`loadIgnoreReasons`: untrusted or read-only devices are skipped) stays as a filter on the reader. The trust list also defines which devices count as active for compaction. Note that the compactor bakes in only what it has merged, and a device cannot be un-merged afterwards.

**Removing a device** (Trusted Devices page) offers to clean up its data in the bucket:

- It stops blocking compaction immediately, as it is no longer active.
- Deleting its delta folder first needs a snapshot that covers those deltas, otherwise other devices that have not applied them would lose changes. So the prompt runs a sync and a compaction (snapshot, then delete the removed device's deltas and its legacy `<deviceId>.ydoc`).
- Its `manifests/<deviceId>.json` is left alone: it also holds the Beancount file entries that file sync compares, and deleting it could resurface older hashes as the "newest".
- The option is skipped when offline or the bucket is not configured; the device is then just removed from the list, and the bucket data can be cleaned up from the S3 explorer.

### Transport abstraction

S3 and WebDAV currently duplicate the CRDT logic (`s3Sync.syncCrdt` vs `webdavSync`). Introduce a small `RemoteStore` interface (`list(prefix)`, `get`, `put(onlyIfAbsent?)`, `delete`) with S3 and WebDAV adapters, and implement the protocol once on top of it. Encryption sits in the adapter wrapper: S3 as now, WebDAV plain unless we decide to add it.

## Other Concerns

- **Encrypt content**: per-object AES-GCM exists. Add the object key as AES-GCM additional data so an object cannot be replayed under another name or seq; this needs a format version byte in `s3Crypto`, with decrypt falling back to the old format for legacy objects.
- **Validate on read**: size cap before decrypt; seq parsed from the key; catch decode errors per object and skip it with a warning (never abort the sync); after merge, validate record shape (`XactRecord` / `ScxRecord`) and report failing records instead of silently rendering them.
- Many tiny objects: batching comes from the existing 2 s debounce plus the compaction thresholds. List pagination is already handled in `listObjects`.
- Mixed versions: an old app version keeps reading and writing legacy `<deviceId>.ydoc`. New devices keep consuming it as a snapshot; they stop writing it once on the new layout. The PWA auto-updates, so the overlap is short, but note it in the release.
- Server mtime is informational only; correctness rests on seq, coverage and state vectors.

## Plan

### Phase 1: protocol core, no cloud

- [x] `RemoteStore` interface + in-memory fake for tests (`src/lib/sync/remoteStore.ts`)
- [x] `BUCKET_ORIGIN`, origin option on `importState`, `exportDelta` (`crdtDocStore.ts`)
- [x] writer with outbox and fat-delta fallback, reader (`snapId`, `applied`, gaps, 404 retry), listing-based status (`src/lib/sync/deltaSync.ts`). The outbox is kept in the device state (`DeltaStateStorage`), to be backed by device settings in Phase 2.
- [x] Vitest with simulated devices (`tests/unit/deltaSync.test.ts`): concurrent edits and deletions, duplicate application, crash between PUT and bookkeeping, lost outbox, peer-merged ops reaching the bucket, snapshots, gaps, damaged objects, ignored devices
- Note: `Y.encodeStateVectorFromUpdate` returns an empty vector for a delta that does not start at clock 0, so the clocks a delta reaches are computed from `Y.decodeUpdate` (`vectorOf`). Anything else that compares deltas by state vector must do the same.

### Phase 2: S3 adapter and migration

- [ ] S3 adapter, legacy `.ydoc` read as snapshot, switch `syncCrdt`, `crdtStatus`, `previewCrdtChanges`, `diagnoseCrdt`, `fetchRemoteOverview`, `listBucketDevices` (device id now comes from the folder), S3 explorer preview of `.upd` and snapshots
- [ ] AES-GCM additional data + format version
- [ ] trust filter on delta folders; Trusted Devices removal prompt with bucket clean-up (after Phase 3)

### Phase 3: compaction and reset

- [ ] compaction with coverage, thresholds, 404 fallback, concurrent-compaction tests
- [ ] reset writes a new-generation snapshot; tests listed above

### Phase 4: WebDAV adapter

- [ ] flat-name adapter on `WebDavClient`; replace `needsMerge`/`crdtMergeState` for CRDT files; keep the UI on `/backup/webdav`

### Phase 5: hardening

- [ ] validate-on-read, size caps, two-device test against a real bucket (also open from the S3 project)

Phases 1 and 2 (S3 only, deltas accumulating without compaction) already deliver the traffic reduction; compaction (Phase 3) is needed before the delta count grows.

## Open questions

- Does WebDAV need encryption as part of this, or stay as is?
- Remove the legacy `<deviceId>.ydoc` objects automatically after migration, or leave them?
