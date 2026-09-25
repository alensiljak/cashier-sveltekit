# Better Synchronization

## Goal

The goal is to have a more elegant synchronization between Cashier instances (i.e. desktop <-> mobile) and simplify the journal entry from the working file on a device.
The Device sync should be the standard data exchange mechanism. Archiving to the journal repository should happen periodically.

## Problem

Cashier (SvelteKit PWA, OPFS storage) currently saves to `cashier.bean`, which gets manually moved into the journal and committed to git. Rescanning local files for sync is slow, and Trystero P2P sync only works on the same LAN — off-LAN peers can't find each other (likely NAT/TURN issue, since mobile carriers are usually behind CGNAT).

Constraints:

- Mobile filesystem access (even via Vivaldi) is slow and prompts the user, so OPFS must stay the primary app storage on phone.
- Desktop can use a persisted File System Access directory handle to read/write the real ledger folder directly.
- Beancount transactions have no stable ID; adding one would require custom metadata.
- A WebDAV server is already running and currently used to back up `cashier.bean` on change. This file will need to be manually removed from WebDAV and OPFS.

## Solution

### ✅ Device Store

The currently-used `cashier.bean` file, holding the unarchived working set, would be replaced by a different store.

Yjs as the shared data model, not the file format: each transaction is a keyed record (generated ID) in a `Y.Map`/`Y.Array`, synced via CRDT rather than by diffing text files. Offline-first, resumable via state vectors, idempotent merging.

Per-device files would avoid merge conflicts. But any other operation, other than append, would require a mechanism for tracking deletes, edits, etc. This is what Yjs provides, so the preference is on using a Yjs with Indexeddb storage.

The working copy (transactions) is assembled on the fly by reading it from IndexedDb and passed as an include to Rustledger's Journal, the way it is currently being read from OPFS.

Each transaction is one (JSON) record, including an ID (ULID) and eventually a schemaVersion. The current Xact record JSON can be stored directly.

### ✅ Device Management

There will be a device management, similar to Trusted Peers in p2p setup.
Each device will have a separate file in WebDAV store, representing their Yjs document state. These files will be merged into the logical Yjs document on the current device and stored in IndexedDb. This avoids issues during file synchronization with WebDAV between concurrent devices since each file is only written by one device.
Duplicate records are ignored in a CRDT store so the records appearing in multiple files are not a problem.

### ✅ Device Sync

The content would be synchronized between multiple instances of Cashier, for example mobile and desktop.

There are two options to consider: server and serverless.

- The server option includes a headless y-websocket instance running on a server, being always available for a sync with a device. It would also serve as a backup copy.
- The serverless option would utilize:
  - P2P as the fast path when both peers are online and
  - the existing **WebDAV as a store-and-forward relay** for when they're not (each device pushes its full Yjs state to its own file on WebDAV, others pull and merge on wake/reconnect).
  - TURN server would fix P2P directly but isn't required if the WebDAV relay is in place.

The preferred option is a file store (WebDAV). If this shows as enough during usage, the server option might be redundant. It requires more setup than a WebDAV server and is therefore discouraged.

### ✅ Archiving

Archiving is the process of moving records from the active working set into the .bean files that are committed to a git repository.
A desktop instance would be used to perform this due to performance. If necessary, a mobile instance could also do this but is slower and requires more user prompts.

After moving the records, they are deleted in the Yjs doc so they don't get re-exported — followed by occasional compaction of the doc's history. The deletions are propagated via tombstones.

To distribute the archived records to the devices, the Beancount files need to be re-synchronized. This is done via

1. git,
2. p2p sync,
3. WebDAV (optionally keep the whole Beancount repo in WebDAV) - not in scope

### ✅ Known Limitations

- ✅ Until a device pulls and imports the updated journal files, the archived transactions are absent from its ledger, since the doc deletions reach it before the journal does.
- ✅ A concurrent edit of a record that is being archived loses to the delete.
- ✅ Once archived, a transaction is no longer editable through the doc; it lives in the journal files (git is the source of truth).

### ✅ Clean-up

The devices should periodically compact the CRDT store, purging the deleted items. With `gc` on by default, this is done automatically, keeping only tombstones.
To clean-up the tombstones, we would need to keep the epoch or a reset marker so that deleted records don't reappear. Rebuilding the doc with an epoch is rarely needed, though.
The files from old devices can be deleted by a WebDAV editor.
Removing a trusted device stops synchronizing that device's file.

## Implementation Plan

1. ✅ A Yjs document with y-indexeddb store, the record schema, serialization to beancount format for inclusion in WASM journal.
2. ✅ Any existing records in `cashier.bean` migrated manually.
3. ✅ Transaction editor adaptation to the new store.
4. ✅ WebDAV per-device relay.
5. ✅ Archiving and deletions.
6. ✅ p2p sync of the working set.
7. Compaction.

### Step 5 and 7 Details: Keeping the Store Small

Why it grows: records are whole JSON values in a `Y.Map`. Deleting one (archive) or overwriting one (edit) leaves a tombstone. `gc` frees the deleted _content_, but the item struct stays, because its parent map is alive. Map items of different keys do not merge with each other, so each tombstone costs roughly the record's ULID key plus the item header (tens of bytes, _estimate, unmeasured_). Live records are small; the tombstones are what accumulates, and they are carried in every device's state file on WebDAV as well as in IndexedDB.

#### Step 5: Archiving

- Delete in one `doc.transact` per archive run, so it is one update and one delete-set range set.
- Write the `.bean` files first, delete from the doc after the write succeeds. A crash in between re-exports on the next run, so add the record ID to the archived transaction (metadata, e.g. `cashierId: "<ULID>"`) and skip IDs already present in the journal. This also gives the archive a duplicate check.
- Archive in bulk (everything older than N days or everything not pending review) rather than one record at a time: fewer runs, fewer epochs needed.
- Report the store's size after archiving (see Measure below), so the user sees the effect.

#### Step 7: Compaction

`gc` alone is not enough (see above). Options, cheapest first:

1. **Measure.** Show on the WebDAV/settings page: live records, deleted items, encoded state bytes (`exportState().length`). Only compact when it matters (e.g. state > 1 MB, or deleted > live × 5). Until that is measured, the rest may be unnecessary.
2. **Compress the relay files.** Gzip (`CompressionStream`) the `.ydoc` files on WebDAV. Yjs updates are repetitive (ULIDs, JSON keys), so this should shrink them several times over. Store-only, no protocol impact; a marker or extension tells old from new files.
3. **Epoch reset (rebuild).** Build a fresh `Y.Doc` from the live records only (same IDs), which drops all tombstones. Needs an epoch so old state cannot bring deleted records back:
   - The epoch number is written in each device's `.ydoc` file envelope, and in the IndexedDB name (`cashier-xacts` for epoch 0, then `cashier-xacts-e<N>`), so an old database is never mixed into a new doc.
   - Peers and WebDAV merges ignore state from a lower epoch. Old-epoch files are then safe to delete.
   - Only the archiving device (desktop) resets, and only right after merging every trusted device's file, so that little is outstanding.
   - The resetter first writes a final old-epoch file. A device that finds a higher epoch merges that final file (so it learns the archive deletes), diffs its live records against the new epoch, and re-adds those that are missing (local work the resetter never saw). Then it switches to the new database and removes the old one.
   - Reset is rare (after big archive runs, when the measure says so), so this can be a manual "Compact store" action at first, not automatic.
4. **Drop old device files** from WebDAV when a device is retired (already possible by hand). Epoch reset makes this automatic for stale epochs.

Not worth doing: shortening record JSON keys or splitting records into per-field Yjs types. Live data is small and per-field types would add tombstones on edit.

y-indexeddb already folds its update log into one after a number of updates, so the IndexedDB side needs no extra work beyond the epoch switch.

### Open Issues

Items marked _unverified_ were not checked in a browser or against the code.

#### ✅ WebDAV Sync

Implemented on the WebDAV backup page (CRDT store only): all `cashier-xacts-<id>.ydoc` files are listed and matched against Trusted Peers by device ID. Untrusted files can be trusted (added to Trusted Peers) or deleted; a manual "Merge trusted devices" button merges the files that changed since their last merge. Records carry an `origin` device ID, shown as a badge in the Device Journal for records created elsewhere. Merging does not run automatically.

Open: merged records are only visible in the ledger after "Reload Ledger". Records created before `origin` was added have no origin and show no badge. Not covered by tests yet.

#### Data fidelity

- `toBeancount()` rebuilds text from the `Xact` fields via `xactToBeancountText`. Anything the model does not carry (comments, tags, links, other posting-level details) is lost on the way out. _Unverified_ which of these the model covers.
- `xactToBeancountText` rewrites data: it forces the `!` flag on postings without an account and writes explicit zero amounts. The OPFS store keeps the source text verbatim, so the two stores can produce different ledgers from the same input.

#### Persistence and sync

- ✅ `scheduleBackup()` is called on every CRDT write, remove, clear and remote merge. `doBackup()` detects the CRDT store and uploads `exportState()` (the Yjs state) to this device's own `ydocFilename(deviceId)` file, so the CRDT data is covered by the WebDAV backup. OPFS `cashier.bean` is only uploaded when the OPFS store is active. The CRDT path does not update the `cashierBean` sync baseline, as it has no such baseline.
- ✅ y-indexeddb keeps its own database (`cashier-xacts`), separate from the Dexie one; this cannot be changed without dropping y-indexeddb (e.g. storing a `Y.encodeStateAsUpdate` snapshot in Dexie instead).
- Two open tabs each hold their own `Y.Doc` on the same database. y-indexeddb does not propagate changes between them live, so a tab may show stale data or overwrite-by-merge on next load. _Unverified_; likely needs a BroadcastChannel provider or a single-tab guard.
- ✅ The `initialized` flag lives in the shared doc. Once devices merge docs, a new device would count as initialized. Decide whether that is intended.
- ✅ Persistence has only been checked manually (the ledger loads the CRDT store's content). No automated tests for `CrdtXactStore`.

#### Other code paths

- Code that reads or writes `cashier.bean` in OPFS directly still bypasses the store choice: `appService.stripIncludesFromBookFile()` / `saveCashierFile()`, the export page, `opfsExport`, and the import-ledger page. _Not audited_ beyond a search for `CASHIER_XACT_FILE`.
- Onboarding with CRDT selected on a clean slate (demo data, import, empty) is _unverified_, as is whether the demo and import flows write transactions through the store.
