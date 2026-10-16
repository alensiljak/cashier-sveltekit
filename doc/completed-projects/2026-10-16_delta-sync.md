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
crdt/<kind>/<deviceId>.<seq>.upd      delta; seq = 000001, 000002, ... (zero-padded, per device)
```

The names are flat: one folder per kind, no folder per device. A device's objects are found by the prefix `<deviceId>.`, and a device ID (UUID) contains no dot.

The coverage map is stored inside the (encrypted) snapshot object. Readers fetch the snapshot anyway when it is newer than theirs, so the key needs nothing but the ULID.

WebDAV (Phase 4): the same flat names inside one folder, with `crdt/<kind>/` mapped to `cashier-<kind>-` (today's file name pattern), so the adapter only renames and the protocol is shared. No MKCOL or per-folder PROPFIND needed.

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

- **Acknowledgements**: after each sync, a device writes what it has applied to its own small object `crdt/<kind>/<deviceId>.ack`: `{ snapId, applied: {deviceId: seq} }`. It is written only when `applied` changed (its own uploads are not part of it), and it can only lag behind reality, which is the safe direction. It is a plain object in the same flat folder, so S3 and WebDAV share the mechanism (the manifests are not involved), and removing a device deletes it with the rest of its objects.
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
- Its `manifests/<deviceId>.json` is deleted too. It holds the Beancount file entries that file sync compares, but the source of truth for those is the git repository or the local storage folder, not the bucket; the remaining manifests and the `data/` objects stay authoritative (`repairManifest` already trusts the object over a manifest entry).
- The option is skipped when offline or the bucket is not configured; the device is then just removed from the list, and the bucket data can be cleaned up from the S3 explorer.

### Transport abstraction

S3 and WebDAV currently duplicate the CRDT logic (`s3Sync.syncCrdt` vs `webdavSync`). Introduce a small `RemoteStore` interface (`list(prefix)`, `get`, `put(onlyIfAbsent?)`, `delete`) with S3 and WebDAV adapters, and implement the protocol once on top of it. Encryption sits in the adapter wrapper: S3 as now, WebDAV plain unless we decide to add it.

## Other Concerns

- **Encrypt content** (done): per-object AES-GCM with the object key as additional data (format version 2) so an object cannot be replayed under another name or seq. S3 is always encrypted. WebDAV has a switch and a passphrase in the WebDAV configuration (device-only); the folder's `cashier-key.json` marks it as encrypted and holds the key-derivation parameters. When the folder and the switch disagree, syncing refuses (`EncryptionMismatchError`) and the configuration page offers to encrypt or decrypt every file in the folder (resumable). The settings backup (`settings.json.gz`) and the legacy state files stay plain.
- **Validate on read** (done): objects larger than 64 MB are not read; the sequence number comes from the key and must follow without a gap; a damaged object is reported and skipped, never aborting the sync; records that come in are checked for shape (`validateRecord` of `crdtXactRecord` / `crdtScxRecord`) and the invalid ones are reported. They are not removed.
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

- [x] S3 adapter (`s3RemoteStore.ts`); device state in device settings per store and bucket (`deltaStateStorage.ts`, key `delta-sync-state`)
- [x] legacy `crdt/<kind>/<deviceId>.ydoc` files are still merged (once per change of the file, by size and modified time) and are never written any more
- [x] `s3Sync.ts` switched: `syncCrdt`, `crdtStatus` (now listing only), `previewCrdtChanges`, `diagnoseCrdt`, `fetchRemoteOverview`, `listBucketDevices` (device id from the delta folder), S3 explorer preview of `.upd` and snapshots
- [x] AES-GCM additional data: delta and snapshot objects are bound to their key (format version 2); legacy state files and everything else stay version 1
- [x] trust filter applies to delta folders and legacy files
- [x] flat object names (`crdt/<kind>/<deviceId>.<seq>.upd`), see Layout
- [x] the outbox capture starts when a store opens (`attachConfiguredRemotes` in `deltaSyncRegistry.ts`, called from the store registries) for the remotes that are enabled and configured, without a passphrase or network
- [ ] try against a real bucket with two devices, one of them still on the old version

### Phase 3: compaction and reset

- [x] acknowledgements: each device writes what it applied to its own `<deviceId>.ack` object, only when that changed (`DeltaSync.publishAck`); moved out of the S3 manifests in Phase 4 so that WebDAV shares it
- [x] compaction (`DeltaSync.compact`, `needsCompaction`): 30 deltas or a week; deletes deltas that every active device acknowledged, the own legacy `.ydoc`, and all but the newest two snapshots. Active = trusted, `.ack` object younger than 30 days. A device without an acknowledgement (an old app version, or never synced) holds nothing back; one whose acknowledgement cannot be read holds everything back until it writes a new one. Runs after an upload, from the listing, and never fails the sync.
- [x] reset (`CrdtDocStore.onReplaced`): our own reset publishes the new generation as a snapshot and removes our old deltas and older snapshots; adopting another device's reset empties the outbox and the known bucket state
- [x] Trusted Devices removal prompt (`forgetBucketDevice`, `DeltaSync.forget`): merges, snapshots, deletes the device's objects and manifest; "Remove anyway" when that fails
- [x] tests in `tests/unit/deltaSync.test.ts`: compaction (acknowledged, partly acknowledged, nothing to delete, snapshot retention, legacy file, damaged object), acknowledgements, reset, forgetting a device
- [x] manual "Compact now": S3 explorer menu ("Compact sync data", `compactBucketNow`) and the WebDAV device list (`compactWebDavNow`)

### Phase 4: WebDAV adapter

- [x] `WebDavRemoteStore` (`webdavRemoteStore.ts`): protocol key `crdt/<kind>/<name>` is the flat file `cashier-<kind>-<name>`, so the older `cashier-<kind>-<deviceId>.ydoc` files are found as legacy files. No conditional PUT (it would need a CORS allowance); an existence check stands in. Content stays unencrypted, as before.
- [x] shared `deltaSyncRegistry.ts` (one `DeltaSync` per store and remote, trust list, `afterSync`), used by S3 and WebDAV
- [x] `webdavDelta.ts`: upload, check (listing only), merge, full sync, compact now, device list, forget device. `webdavSync.ts` and `webdavAutoBackupService.uploadCrdtState` delegate to it.
- [x] UI on `/backup/webdav` and `YdocDevices.svelte` rewired; the per-file merge state (`needsMerge`, `crdtMergeState`) and file-name helpers are gone from `ydocDevices.ts`
- [x] tests: `tests/unit/webdavRemoteStore.test.ts`, `tests/unit/webdavAutoBackupService.test.ts` (rewritten for deltas)

### Phase 5: hardening

- [x] validate on read: size limit (`MAX_OBJECT_BYTES`), shape check of incoming records (`DeltaSyncOptions.validate`, `DownloadResult.invalid`, reported by S3 sync lines, WebDAV messages and the merge notice)
- [x] WebDAV encryption: `EncryptedRemoteStore` (any `RemoteStore`), `webdavEncryption.ts` (switch, key file, `remoteFor`, `convertWebDavFolder`), switch and conversion dialog on the WebDAV configuration page
- [x] legacy files are removed once a device has moved on (`DeltaSync.cleanLegacy`, after every upload): a device's first delta carries everything its legacy file held, so the file goes as soon as this device holds that delta. A device still on the old version keeps its file.
- [x] automatic reset of an emptied document (`DeltaSync.resetIfDue`, after every upload): no records left, at least `RESET_MIN_STATE_BYTES` of history, everything merged, and every trusted device with a recent acknowledgement has applied everything this device has, the deletions included. A trusted device that has synced but never acknowledged (an old app version) is waited for; one that has not acknowledged for 30 days, or never synced, is not. The new generation is published as a snapshot straight away; the others adopt it on their next sync and keep what they created and had not uploaded.
- [x] unsent changes at a reset: the device that resets has none (it uploads first, and only resets an empty store). A device that adopts a reset keeps the records it created since (they are sent again as a delta). When that would drop records here that have unsent changes (an edit to a record the other device deleted), the user is asked first (`setAdoptConfirm`, `CrdtDocStore.onAdoptCheck`); cancelling leaves everything as it is (`DownloadResult.declined`) and the question comes again at the next sync.
- [ ] two-device test against a real bucket and a real WebDAV folder, one device on the old version

Phases 1 and 2 (S3 only, deltas accumulating without compaction) already deliver the traffic reduction; compaction (Phase 3) is needed before the delta count grows.

## Things to try on real devices

1. Two devices on the new version, S3: enter a transaction on one, sync on the other; check in the S3 explorer that the new objects are small `.upd` files and that `.ack` files appear. Preview a `.upd` and a snapshot.
2. After 30 uploads or a week, or with "Compact sync data": the deltas are replaced by a snapshot and the older ones are deleted.
3. One device still on the old version: it keeps writing `<deviceId>.ydoc`; the new device merges it. After the old one is updated, its legacy file disappears.
4. Sort all transactions out on one device (working set empty), sync both devices: after the second device has synced and acknowledged, the next sync on the first resets the store (state size drops, one new snapshot, old deltas of that device gone) and the other adopts it.
5. Remove a trusted device on the Trusted Devices page with the bucket clean-up ticked: its objects and manifest disappear and nothing is lost on the others.
6. WebDAV: the same as 1 and 2, then turn encryption on in the WebDAV configuration (with files already in the folder) and check that every `cashier-<kind>-...` file is encrypted and `cashier-key.json` appears. Try syncing from a second device with the switch off: it must refuse with the mismatch message until it is switched on with the same passphrase.

## Open questions

- None at the moment. Not done on purpose: a rebase that keeps live records while clearing the tombstones (see the discussion of reset: edits to existing records made elsewhere would be lost), and encryption of the WebDAV settings backup.
