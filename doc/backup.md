# Backup, Restore, Destroy and Sync

How Cashier handles its data in these operations: what happens to which data, and why.

This is the intended design. Not all of it is built yet: the [project plan](projects/2026-11-28_backup-consolidation.md) has the tasks and the progress. The user-facing explanation is in the [help pages](help/backup.md). The format that preceded this design is described in [Backup and Restore of a Whole Device](completed-projects/2026-11-12_backup-restore.md).

## Principles

- Each operation is explicit and can be done by hand: back up, destroy, restore, sync. Combined flows can come later.
- Each group of data has its own toggle. Nothing optional is packed or restored automatically.
- Destroying and restoring act on this device only. They send no reset or deletion marker to other devices. A later sync shares whatever this device holds that the others have not seen.
- Sync brings a device up to date with the changes still available from other devices or remote storage. A mistake that has already been synced is part of that history and comes back. Rolling it back on all devices is out of scope.

## Backup contents

| Group           | Contents                                                                            | Control                          |
| --------------- | ----------------------------------------------------------------------------------- | -------------------------------- |
| Shared settings | the shared settings table                                                           | always included                  |
| Transactions    | working set; scheduled transactions                                                 | one toggle each, on by default   |
| This device     | portable device settings, sync setup, trusted and evicted devices, source device ID | on by default                    |
| Credentials     | every secret, whichever other groups are chosen                                     | off by default, always encrypted |

### This device

The portable device settings include the home cards, device name, notifications, sync options, speech engine, speech language, voice mode, Mistral model and stale-sync days.

Folder names are not included. A folder has to be picked again, so showing its old name would be misleading. This also applies when an older file holds them.

Notifications are restored as enabled only if the browser permission is already granted. The reminder time is always restored.

### Credentials

- WebDAV connection (the password is the secret; it belongs to the shared settings)
- S3 connection: endpoint, region, bucket, prefix, access key ID, secret access key, encryption passphrase
- WebDAV encryption passphrase
- TURN servers
- proxy connection: URL and key
- Mistral API key
- Aware Super API key
- Scalable Capital tokens
- Enable Banking application ID, private key and sessions

Credentials are never synced. They leave the device only in this encrypted group. An old token or an expired bank session can still require signing in again.

**A connection is kept as one unit.** The Credentials group holds the whole connection, URL and secrets together, encrypted. The plain group (This device, or Shared settings for WebDAV) holds the same connection with its secrets blanked.

- Restoring Credentials overwrites each connection in the file as a whole, so a secret cannot be paired with another URL. This also works when Credentials is the only group restored.
- Restoring without Credentials fills in the plain fields, and keeps a local secret only when the connection details match.

The proxy URL and key are one `{ url, key }` setting. Secrets that are plain strings, such as the proxy, Mistral and Aware keys, are encrypted as whole values.

### Not backed up

- OPFS files. The book is imported from a Git repository.
- The device signing key (not extractable), the peer ID, the sync group secret
- Sync progress, last-sync times, S3 hashes, file-sync baselines, pending introductions
- Folder names and folder handles
- Caches, price download status, bank balances, pending bank authorizations
- Reconciliation drafts and layout state in `localStorage`

### Peer Sync data

| Data                                                   | Backed up | Reason                                                                        |
| ------------------------------------------------------ | --------- | ----------------------------------------------------------------------------- |
| Trusted devices                                        | yes       | S3 and WebDAV use the list to accept other devices' data and check signatures |
| Evicted devices                                        | yes       | kept together with trusted devices                                            |
| Device name, relay choice, TURN servers, sync switches | yes       | configuration                                                                 |
| Source device ID                                       | yes       | its uploads are recognized after a restore                                    |
| Signing key, group secret, introductions, baselines    | no        | tied to the old device, or supplied again by pairing                          |

A restored new device still has to be paired: the others do not trust its key. After pairing with one, it can introduce the rest for approval.

## Preventing omissions

1. **Every key has a backup rule**: plain, whole-value secret, secret fields, or excluded. Both backup lists are generated from the rules. The rules are typed against all declared keys, so `npm run check` fails when a key has none.
2. **Only declared keys can be written.** `set()` accepts the declared key types, plus `importer.${string}` for shared settings.
3. **Unsafe reads are obvious.** The read that returns everything is named `getAllWithSecrets()`: it is not used unless the secrets are needed. Backup and sync use the safe export.

The types cannot detect a new secret inside an existing object. The importer configs need a comment and tests.

## File format

- The whole file is gzipped with `CompressionStream` (`.json.gz`).
- Only the Credentials block is encrypted (PBKDF2 and AES-GCM). It is encrypted before the file is compressed. Everything else can be read without a passphrase.
- Both transaction stores are saved as Yjs state, which includes their history.
- The file lists its contents without encryption, including which credentials the block holds, so they can be shown before a passphrase is entered.
- Where a browser cannot share gzip files, Share sends plain JSON.
- The file records its format version. A file from a newer app is refused.

### Version modules

Each format version is read by its own module, which keeps the history visible and avoids version checks spread through the code. Writing and applying exist once.

```text
services/backup/
  index.ts       decompress, detect the version, choose the reader
  model.ts       the data a restore works with
  secrets.ts     secret fields, and the encrypted credentials block
  readers/       one module per format version: validate and convert
  write.ts       writes the latest version only
  apply.ts       restore logic for all versions
```

- A reader keeps its own definition of its format and does not depend on the current key lists.
- The model holds both the individual secret fields of version 2 and whole connections. Version 2 secrets keep the connection-matching rule.
- Current safety rules apply to all versions.
- Each version has a fixed sample file in the tests (`tests/data/backup/`). A sample is never edited or regenerated.

## Restore

### Screen text

The screen stays uncluttered. Explanations go to the help page, opened with the `?` button. The screen shows only:

- short reasons next to disabled options
- the result of the restore
- short warnings where data can be destroyed or spread

### Reading the file

- Compression is detected from the content (gzip magic bytes), not the file name. Plain JSON is accepted.
- The page shows the format version, whether the file is compressed, and whether it has encrypted credentials.
- All groups are always listed. A group the file does not contain is greyed out. For older files this includes everything their format cannot hold.
- The whole file is validated before anything is written or destroyed.
- The passphrase is only needed for Credentials. With a missing or wrong passphrase, the other groups can still be restored, and the result says so.

### What restore does

Each group has its own toggle. Shared settings is on and locked when the file has it.

| Data                                | Effect                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Shared settings                     | replaced; without Credentials, a local WebDAV password is kept for the same server                |
| Device settings                     | settings in the file overwrite local ones; others stay                                            |
| Credentials                         | connections and keys in the file overwrite local ones; others stay                                |
| Trusted and evicted devices         | missing entries are added; evictions apply; `fileSyncInitializedAt` is removed from added devices |
| Working set, scheduled transactions | **merged** into the store; restore never replaces or clears a store                               |
| Identity and signing key            | unchanged                                                                                         |

`fileSyncInitializedAt` is removed because the file-sync baseline it refers to is not restored. With it, pairing would never create the baseline again.

The source device ID is recorded as the previous device only if this device has never synced. A restored transaction store does not count against that, so the order of manual steps does not matter.

### Transaction scenarios

There is one import operation: merge. The scenarios differ only in what the store holds beforehand.

| Scenario                    | Steps                 | Result                                                      |
| --------------------------- | --------------------- | ----------------------------------------------------------- |
| New device                  | restore               | the backup's state, ready to use; sync brings newer changes |
| Existing device, start over | destroy, then restore | the backup's state; sync brings newer changes               |
| Existing device, combine    | restore               | the backup's changes merged into local data                 |

The user chooses per store, so one store can be destroyed and the other merged.

### What merge does and does not do

- It adds what the store has not seen.
- It does **not** undo later deletions or edits. Merging an older backup of this same device may change nothing. To return to the backup's state, destroy first.
- It can change or delete local records, if the backup holds changes made elsewhere. Concurrent edits of one record are not resolved by time.
- A backup made before a store reset is ignored.
- A backup made after a reset on another device replaces the local document. Records the resetting device had not seen are kept.

Before restoring, the page shows how many records would be added, changed and deleted in each store (`previewImport`). If a backup is ignored, the result says so and points to Destroy. A restore that added nothing is never reported as a plain success.

### Lists without history

Version 1 and 2 files hold scheduled transactions as a list. Merging such a list adds the missing IDs, keeps existing records and deletes nothing.

Without history, sync cannot tell that the restored entries are older. Even into an empty store, a later sync can bring back deleted entries, or let the old versions replace newer edits, also on other devices. The page warns about this. If current data is available through sync, the old list is better left out.

Saved state does not have this problem, which is why the transaction stores are backed up as state.

### Other warnings

- Restore trusted devices only from a file you trust. The page shows how many would be added.
- An old backup can trust a device that was evicted later. A new device does not know until it receives the eviction.

### Onboarding

A new device can restore from onboarding. **Restore from backup** initializes empty stores, as **Start empty** does, and opens the restore page.

Demo data gives the stores a history. Destroy them before restoring over it.

## Destroy a transaction store

Destroy deletes one store's local data **and history**, and leaves an empty, initialized store. It exists because merge cannot return a store to an earlier state.

It is not a reset:

| Reset                                     | Destroy                  |
| ----------------------------------------- | ------------------------ |
| needs an empty store                      | works on any store       |
| writes a reset marker                     | writes no marker         |
| other devices adopt it                    | affects this device only |
| publishes a snapshot, removes old objects | touches nothing remote   |

### Where it is offered

- In Settings, for starting over from sync without a backup file.
- On the restore page, for the **selected** stores that have a history, in a box with a red border and warning icons.

It is its own button with its own confirmation, separate from Restore. It is never a side effect of restoring. On the restore page, the chosen file and selections stay in place afterwards.

### The confirmation

- It says what is deleted, with the record count, that only this device is affected, and that only data in a backup or another copy can be recovered.
- It says what is set up to recover from: S3 or WebDAV, Peer Sync only, or nothing. With nothing, it says that the data is permanently lost without a backup. A configured sync is never presented as a guarantee.
- It offers a backup of the store. The app cannot tell whether the file was saved.
- Destroy stays disabled until the user picks **I have checked that I have a usable backup** or **I accept permanent loss**.
- It does not require a working sync, so a store can be destroyed offline.

### Safety

- Live Peer Sync is disconnected. No sync starts as a side effect of destroying.
- No other app tab may be open, as it could write the old data back. Open tabs are detected with the Web Locks API (`utils/appTabs.ts`). A tab opened while a destroy is running is not blocked.
- Destroy does not schedule an automatic backup.
- The document is swapped in place, without a reload.

### Getting data back

| After destroy                                | Result after sync                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| sync only                                    | what the source still holds                                                   |
| restore of saved state, then sync            | current                                                                       |
| restore of a list without history, then sync | **not reliable**: old versions can replace newer ones, deleted entries return |

Without sync and without a backup, destroyed data cannot be recovered. With Peer Sync only, another device can send back just what it has, when it is online.

## Delta sync after destroy

A destroyed store keeps the device ID. Without special handling:

- the saved progress would say updates were already applied, and they would be skipped
- downloads would skip this device's own uploads, so its later changes would not be recovered, and changes by other devices that depend on them might not apply
- the unsent queue could still upload the data that was destroyed

The entry point is `destroyLocalStore(kind, store)` in `sync/deltaSyncRegistry.ts`. It uses `CrdtDocStore.destroy()`, which must not be called on its own while the store may be synced.

1. **Syncs under way are finished and closed.** A closed sync takes no more work and cannot save its old progress. No new sync is set up while a destroy runs.
2. **The destroy is marked before it happens**, with one value per store (`delta-sync-epoch:<kind>`). Saved progress from before the mark does not count. This covers every remote, including ones with no saved progress or not currently configured. If the app stops before the store is deleted, the next sync merely applies everything again.
   - Cleared: `snapId`, `applied`, `bucketSV`, `outbox`, `legacy`, `acked`, `pendingSnapshot`.
   - Kept: `nextSeq`, `owner`, `retired`.
3. **The remote is then `rebuilding`.** This device's own deltas and legacy state files are applied like any other.
4. **Each download starts from the beginning** until one succeeds. Yjs keeps an update that waits for another one in memory only. Progress from an unfinished download would count it as applied, and a restart would lose it. A remote with a permanent gap or rejected object is therefore downloaded in full every time.
5. **The numbering goes on.** It also follows this device's entry in the newest snapshot, in case there is no saved progress and the deltas are compacted.
6. **Nothing is removed or acknowledged** while rebuilding: no acknowledgement, compaction, legacy clean-up, reset, publishing of a reset, retiring or forgetting. Uploading new changes still works.
7. The rebuild ends after a download with no errors, no gaps and no postponement. It raises no warning about unsent changes.
8. Destroy reports its own replace reason, `destroy`. With `reset`, delta sync would publish it and remove this device's remote deltas and older snapshots.

Peer Sync compares the documents themselves, so it needs no special handling.

A rebuild cannot recover data that no source holds any more.

## Shared settings in sync

- S3, WebDAV and Peer Sync use the safe settings export and import, including their merge, preview and comparison views. The import keeps the local WebDAV password for the same server.
- An empty settings list is not uploaded.
- Before an import changes anything, it rejects an empty list, invalid entries and duplicate keys. On failure, the local settings stay and an error is shown.
- In S3, `data/settings.json` holds the whole shared table, with the WebDAV password blanked, so no shared keys are missing. Device settings are not part of it.

## Backup and sync

The two look and behave the same wherever they do the same thing, so that nobody has to learn two sets of options.

### Two questions, not one

- **Where** the data goes: a local file, remote storage (S3, WebDAV) or another device (Peer Sync).
- **What happens** to it: a backup is a copy from one point in time; sync is an ongoing exchange of changes.

Storage does not decide the second. A backup file kept in S3 would still be a backup, and a synced bucket is not a backup: mistakes and deletions spread through it, and clean-up removes old history. Backup and sync therefore stay two clearly named actions. Another device is also not storage: it has to be online.

### What they share

- The same names, grouping and order for the data options: Shared settings, Working set, Scheduled transactions, This device, Credentials, Beancount files.
- The same presentation: every option is listed, and one that does not apply is greyed out with a short reason.
- The same safety rules: the safe settings export, the checks before an import, previews of what would change, and the warnings.
- Destroy followed by sync or restore, described the same way everywhere.
- Explanations on the help pages, behind `?`.

### Where they differ

| Data                        | Backup                  | Sync                                                                |
| --------------------------- | ----------------------- | ------------------------------------------------------------------- |
| Shared settings             | yes                     | yes                                                                 |
| Both transaction stores     | yes                     | yes                                                                 |
| Beancount files             | no (they come from Git) | S3 and Peer Sync                                                    |
| This device                 | yes                     | proposed: no, so that one device does not overwrite another's setup |
| Credentials                 | yes, encrypted          | no, so that secrets are not spread                                  |
| Trusted and evicted devices | yes, with This device   | have their own exchange (introductions, evictions)                  |
