# Backup, Restore and Destroy

Status: Step 1 of the [implementation order](#implementation-order) is implemented, and Destroy in Settings. The rest is design.

This replaces parts of the [version 2 design](completed-projects/2026-11-12_backup-restore.md). The user-facing explanation is in [help/backup.md](help/backup.md), which is updated when the changes ship.

## Principles

- Each operation is explicit and can be done by hand: back up, destroy, restore, sync. Combined flows can come later.
- Each group of data has its own toggle. Nothing optional is packed or restored automatically.
- Destroying and restoring act on this device only. They send no reset or deletion marker to other devices. A later sync shares whatever this device holds that the others have not seen.
- Sync brings a device up to date with the changes still available from other devices or remote storage. A mistake that has already been synced is part of that history and comes back. Rolling it back on all devices is out of scope.

## Problems in the current implementation

- The proxy URL and key are not backed up, with or without credentials. Neither are the other API keys, the importer tokens, the Enable Banking data, the speech settings or the stale-sync setting.
- WebDAV upload and Peer Sync send `settings.getAll()`, which includes the WebDAV password. Backup and S3 sync blank it.
- `importSettingsJson` only checks that its input is a list. An empty list erases the shared settings.
- Restoring scheduled transactions replaces the list. The deletions can then sync to other devices.
- Restored trusted devices keep `fileSyncInitializedAt`, but the file-sync baseline is not restored, so pairing never seeds it again.
- A restore records the backup's device as the previous device even on a device that has been in use.
- Folder names are restored although folder access is not.
- Notifications can be restored as enabled without browser permission.

## Backup contents

| Group           | Contents                                                                            | Control                          |
| --------------- | ----------------------------------------------------------------------------------- | -------------------------------- |
| Shared settings | the shared settings table                                                           | always included                  |
| Transactions    | working set; scheduled transactions                                                 | one toggle each, on by default   |
| This device     | portable device settings, sync setup, trusted and evicted devices, source device ID | on by default                    |
| Credentials     | every secret, whichever other groups are chosen                                     | off by default, always encrypted |

### This device

Add to the current portable settings: speech engine, speech language, voice mode, Mistral model and stale-sync days. The proxy URL is part of the proxy connection (see below).

Remove `importBookDirectory` and `exportBookDirectory`. A folder has to be picked again, so showing its old name is misleading. The readers for older versions ignore these names too.

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

An old token or an expired bank session can still require signing in again.

**A connection is kept as one unit.** The Credentials group holds the whole connection, URL and secrets together, encrypted. The plain group (This device, or Shared settings for WebDAV) holds the same connection with its secrets blanked.

- Restoring Credentials overwrites each connection in the file as a whole, so a secret cannot be paired with another URL. This also works when Credentials is the only group restored.
- Restoring without Credentials fills in the plain fields, and keeps a local secret only when the connection details match.

`proxy.url` and `proxy.key` become one `{ url, key }` setting, with a migration for existing values.

The Mistral and Aware keys are plain strings. `splitSecrets` only handles fields of objects and lists, so it needs whole-value secrets first. Without that, adding these keys to the lists would write them unencrypted.

Older comments in `settings.ts` and the importers say that these credentials are never exported. They change to: never synced; exported only in the encrypted Credentials group.

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
2. **Only declared keys can be written.** `set()` accepts the declared key types, plus `importer.${string}` for shared settings. `userBookFilename` is added to `SettingKeys`.
3. **Unsafe reads are obvious.** `getAll()` is renamed to `getAllWithSecrets()`, with a comment: do not use it unless the secrets are needed. Backup and sync use the safe export.

The types cannot detect a new secret inside an existing object. The importer configs need a comment and tests.

## File format (version 3)

- The whole file is gzipped with `CompressionStream` (`.json.gz`). The size reduction has not been measured.
- Only the Credentials block is encrypted (as now: PBKDF2 and AES-GCM). It is encrypted before the file is compressed. Everything else can be read without a passphrase.
- Both transaction stores are saved as Yjs state, which includes their history.
- The file lists its contents without encryption, including which credentials the block holds, so they can be shown before a passphrase is entered.
- Some browsers may not share gzip files. If so, Share sends plain JSON. To be tested on a phone.

### Version modules

Only reading is separated by version. Writing and applying exist once.

```text
services/backup/
  index.ts       decompress, detect the version, choose the reader
  model.ts       the data a restore works with
  readers/v1.ts  validate and convert v1
  readers/v2.ts  validate and convert v2
  readers/v3.ts  validate and convert v3
  write.ts       writes the latest version only
  apply.ts       restore logic for all versions
```

- A reader keeps its own definition of its format and does not depend on the current key lists.
- The model holds both v2's individual secret fields and v3's whole connections. v2 secrets keep the connection-matching rule.
- Current safety rules apply to all versions.
- Each version has a fixed sample file in the tests. The v1 and v2 samples are made before the refactoring.

## Restore page

### Screen text

The screen stays uncluttered. Explanations go to the help page, opened with the existing `?` button. The screen shows only:

- short reasons next to disabled options
- the result of the restore
- short warnings where data can be destroyed or spread

### Reading the file

- Compression is detected from the content (gzip magic bytes), not the file name. Plain JSON is accepted.
- The dialog shows the format version, whether the file is compressed, and whether it has encrypted credentials.
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

Before restoring, the dialog shows how many records would be added, changed and deleted in each store (`previewImport`). If a backup is ignored, the result says so and points to Destroy. It must never report such a restore as successful without saying that nothing was added.

### Scheduled transactions from v1 and v2

These files hold a list without history. Merge adds the missing IDs, keeps existing records and deletes nothing.

Even into an empty store, a later sync can bring back deleted entries, or let the old versions replace newer edits, also on other devices. The dialog warns about this. If current data is available through sync, the old list is better left out.

### Other warnings

- Restore trusted devices only from a file you trust. The dialog shows how many would be added.
- An old backup can trust a device that was evicted later. A new device does not know until it receives the eviction.

### Onboarding

A new device lands on `/onboarding`, which has no restore option. Add **Restore from backup**: it initializes empty stores, as **Start empty** does, and opens the restore page.

Demo data gives the stores a history. Destroy them before restoring over it.

## Destroy a transaction store

Destroy deletes one store's local data **and history**, and leaves an empty, initialized store.

| Existing reset                            | Destroy                  |
| ----------------------------------------- | ------------------------ |
| needs an empty store                      | works on any store       |
| writes a reset marker                     | writes no marker         |
| other devices adopt it                    | affects this device only |
| publishes a snapshot, removes old objects | touches nothing remote   |

### In the UI

- The restore page offers it for the **selected** stores that have a history, in a box with a red border and warning icons.
- It is its own button with its own confirmation, separate from Restore. It is never a side effect of restoring.
- The confirmation shows the record counts, and offers a backup of the current data first. Whatever exists only in the destroyed store is lost without one, including changes that were never synced.
- The chosen file and selections stay in place afterwards.
- It is a reusable component, also offered next to Reset in Settings, for starting over from sync without a backup file.

### The confirmation dialog

Implemented in `DestroyStoreDialog.svelte`, opened from **Destroy Stores** in Settings. The restore page will use the same dialog.

- It says what is deleted, that only this device is affected, and that only data in a backup or another copy can be recovered.
- It says what is set up to recover from: S3 or WebDAV, Peer Sync only, or nothing. With nothing, it says that the data is permanently lost without a backup. A configured sync is never presented as a guarantee.
- It offers a backup of the store. The app cannot tell whether the file was saved.
- Destroy stays disabled until the user picks **I have checked that I have a usable backup** or **I accept permanent loss**.
- It does not require a working sync, so a store can be destroyed offline.
- For scheduled transactions it warns about restoring and then syncing (see below).

### Restored data and sync

| After destroy                                       | Result after sync                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| sync only                                           | what the source still holds                                                   |
| restore of saved state (the working set), then sync | current                                                                       |
| restore of a scheduled-transaction list, then sync  | **not reliable**: old versions can replace newer ones, deleted entries return |

In a temporary test of the last row, 22 of 40 runs ended with the old version and the deleted entry. With saved state, all 40 ended current. Backup files hold scheduled transactions as a list until version 3 (step 5).

### Safety

- Disconnect live Peer Sync. No sync may start as a side effect of destroying.
- No other app tab may be open, as it could write the old data back.
- Destroy does not schedule an automatic backup.
- Swap the document in place, moving subscribers over. If that proves unsafe, reload instead, and the file has to be chosen again.

## Delta sync fix

Destroy keeps the device ID, so delta sync needs changes. Without them:

- the saved progress says updates were already applied, and they are skipped
- downloads skip this device's own uploads, so its later changes are not recovered, and changes by other devices that depend on them may not apply
- the unsent queue can still upload the data that was destroyed

### Implementation

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

Peer Sync compares the documents themselves, so it needs no change.

A rebuild cannot recover data that no source holds any more. Stopping live Peer Sync and handling other open tabs is left to the UI (step 4).

The tests are in `tests/unit/destroyStore.test.ts`. They use the in-memory remote store. S3 and WebDAV share this delta sync code and differ in the transport, so a check by hand against a real bucket and folder is still to be done.

## Sync safety and S3 settings

- WebDAV and Peer Sync use `exportSettingsJson` and `importSettingsJson`, including their merge, preview and comparison views. The import keeps the local WebDAV password for the same server.
- Before upload: do not upload an empty settings list.
- Before an import changes anything: reject an empty list, invalid entries and duplicate keys. On failure, keep the local settings and show an error.
- The format of `data/settings.json` does not change. It holds the whole shared table, with the WebDAV password blanked, so no shared keys are missing. Device settings are not part of it.

## Aligning sync with backup

To be done after backup is consolidated. The goal is that the two look and behave the same wherever they do the same thing, so that nobody has to learn two sets of options.

### Two questions, not one

- **Where** the data goes: a local file, remote storage (S3, WebDAV) or another device (Peer Sync).
- **What happens** to it: a backup is a copy from one point in time; sync is an ongoing exchange of changes.

Storage does not decide the second. A backup file kept in S3 would still be a backup, and a synced bucket is not a backup: mistakes and deletions spread through it, and clean-up removes old history. Backup and sync therefore stay two clearly named actions. Another device is also not storage: it has to be online.

### What to align

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
| Credentials                 | yes, encrypted          | proposed: no, so that secrets are not spread                        |
| Trusted and evicted devices | yes, with This device   | have their own exchange (introductions, evictions)                  |

### To start with

A review of what each channel offers today and where it differs in wording, options and behaviour. The WebDAV sync page, for example, offers settings and the two transaction stores, and no Beancount files were found there. The review also settles the two proposals in the table.

## Implementation order

Each step includes its tests.

1. Destroy operation and delta sync fix, without UI. **Implemented.**
2. WebDAV password leak, settings import checks, key rules.
3. Version modules, with sample files and no change in behaviour.
4. Restore fixes for v1 and v2: merge only, destroy on the restore page and in Settings, preview counts, trusted-device markers, previous device.
5. Version 3: the groups, whole connections, missing settings, folder and notification rules, compression, file recognition.
6. Onboarding option, help page and project documentation.
7. Align sync with backup, starting with the review (see [Aligning sync with backup](#aligning-sync-with-backup)).

## To settle during implementation

- How to detect or exclude other open tabs during destroy.
- Whether the document can be swapped in place while all its users are running.
