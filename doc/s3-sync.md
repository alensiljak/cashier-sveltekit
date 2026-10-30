# S3 Sync: Concepts

A summary of how S3 sync works. Design history and decisions are in `completed-projects/2026-10-05_s3-sync.md` (file sync) and `completed-projects/2026-10-16_delta-sync.md` (CRDT deltas). Planned improvements to the status indicators and actions: `s3-sync-review.md`.

## What is synced

| Item                   | Kind         | How it is compared                     | Conflicts                |
| ---------------------- | ------------ | -------------------------------------- | ------------------------ |
| Local Transactions     | CRDT (Yjs)   | per-device delta files, merged locally | none, merge is automatic |
| Scheduled Transactions | CRDT (Yjs)   | same as above                          | none                     |
| Settings               | shared file  | content hash vs. hash at the last sync | per file, user decides   |
| Beancount files        | shared files | same, per file                         | per file, user decides   |

Credentials and the passphrase stay in device settings and are never synced.

## The bucket

The browser talks to the bucket directly (CORS), with no server in between.

```text
key.json                                   key-derivation parameters (the only unencrypted object)
manifests/<deviceId>.json                  what each device last uploaded: path -> hash, seq, time
data/settings.json                         shared settings
data/files/<opfs path>                     shared Beancount files
crdt/<kind>/snap-<ulid>.ydoc               full CRDT state + coverage map {deviceId: seq}
crdt/<kind>/<deviceId>.<seq>.upd           one delta from one device
crdt/<kind>/<deviceId>.ack                 what that device has applied (used for compaction)
```

`<kind>` is `xacts` or `scx`. Legacy `crdt/<kind>/<deviceId>.ydoc` files are still read, never written.

## Encryption

- AES-256-GCM per object, fresh random IV each.
- The key is derived from the passphrase with PBKDF2-SHA256 (250k iterations). Salt and iteration count live in `key.json`, so every device derives the same key. A check value detects a wrong passphrase.
- Contents are encrypted, object names are not.
- Delta and snapshot objects are bound to their object key (GCM additional data), so one cannot be replayed under another name.

## Devices and trust

Each device has an ID. Its deltas are found by the ID in the object name.

- Transactions are merged **only from trusted devices** (Settings → Trusted Devices). Untrusted and read-only devices are skipped.
- Removing a device offers to merge, snapshot and delete its data in the bucket.

## File sync (settings and Beancount files)

Code: `s3SyncPlan.ts` (decisions, no I/O), `s3Sync.ts`.

- Each device keeps its own **manifest**: the hash of every file it last uploaded. The newest entry for a path across all manifests (highest `seq`, then time) is the **remote** version.
- The **base** is the hash this device saw at its last sync of that path.
- `decide(direction, local, remote, base)`:
  - only one side differs from the base: transfer in that direction;
  - both differ: **conflict**, never overwritten automatically. The user picks _Keep this device_ or _Keep bucket_, after comparing the diff;
  - identical content is "unchanged".
- If only line endings or the final newline differ, the file can be marked as equivalent; nothing is transferred.
- **Deletions** are propagated as a tombstone (`hash: "deleted"`) in the manifest. They are never applied automatically, because a missing file may mean the local storage was cleared. The user confirms each. Deleted on one side and changed on the other is a conflict.
- The manifest is only an index. If it disagrees with the object, the object wins.

## CRDT sync (transactions and scheduled transactions)

Code: `sync/deltaSync.ts`, `s3RemoteStore.ts`, `deltaSyncRegistry.ts`.

- **Upload**: local changes (and operations merged from peers) are collected in an outbox. A sync writes them as one new delta, `<deviceId>.<seq>.upd`. Deltas are never overwritten.
- **Download**: apply the newest snapshot if it is newer than the applied one, then each other device's deltas after the last applied `seq`, in order. A gap stops the application at that point.
- Merging is idempotent and commutative, so duplicates and ordering mistakes are harmless.
- **Compaction**: any device may write a snapshot and delete the deltas that every active device has acknowledged (`.ack` objects), when there are 30 or more deltas or the snapshot is a week old. A device that was away too long just takes the snapshot.
- **Reset** (`reset()`) clears accumulated tombstones: it writes a new snapshot with a new generation id and removes older deltas and snapshots. Operations from before a reset are refused as retired.
- Peer (WebRTC) sync is separate and uses state-vector diffs. Peer-merged operations do reach the bucket through the outbox.

## The sync page (`/backup/s3`)

- **Items**: each row has a badge, the bucket's last-modified time and a review link.
- **Review pages**: _Review diff_ (settings), _Review records_ (CRDT record-level preview, nothing is applied), _Review files_ (Beancount tree and conflict resolution).
- **Automatic backup**: only uploads CRDT state (`backupCrdtStores`); it never downloads or merges.
- **S3 Explorer** (`/util/s3-explorer`): lists objects, previews decrypted content, can compact.

### Reading the badges today

- File items (settings, Beancount): accurate. The badge comes from the same hash comparison a sync would do.
- CRDT items: the arrows come from `DeltaSync.review()`, by record changes.
  - ↓ means a trusted device has a delta (or snapshot) that would change records here. Deltas that change nothing are applied silently, as bookkeeping only. Downloads stay manual.
  - ↑ means the outbox holds operations the bucket lacks. Operations the bucket already holds (merged from a peer after another device uploaded them) are not counted or sent again.
  - New objects are fetched once per session and cached. A missing delta number is reported as a gap.
  - Not covered: a deletion merged from a peer cannot be told from a new one, so it can still show ↑ once.
- WebDAV still uses the listing-only `status()`.

Each row has its own buttons: Download and Upload for transactions, scheduled transactions and Beancount files (each enabled only when its arrow shows), and a single Sync for settings. Conflicts are resolved in the review pages.
