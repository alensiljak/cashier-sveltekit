# Backup Consolidation

Tasks and progress. The design, i.e. what happens to which data and why, is in [backup.md](../backup.md). When a task changes the design, update that document too.

Each step includes its tests, and the help pages for what it changes.

## Decisions needed

- [ ] **This device in sync** (step 8). Proposed: not synced.

## Release and format version

Nothing is deployed until the project is done. So there is **one new format, version 3**. Step 3 starts it and step 6 completes it. Until the release it may change freely, and files made with unfinished versions need not stay readable. Only the released versions, 1 and 2, must still restore.

## Known problems

Each is removed from this list when its step is done.

| Problem                                                                                                                               | Step |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Restoring scheduled transactions replaces the list. The deletions can then sync to other devices                                      | 5    |
| Restored trusted devices keep `fileSyncInitializedAt` without the file-sync baseline                                                  | 5    |
| A restore records the backup's device as the previous device even on a device that has been in use                                    | 5    |
| The proxy URL and key, other API keys, importer tokens, Enable Banking data, speech settings and stale-sync setting are not backed up | 6    |
| Folder names are restored although folder access is not                                                                               | 6    |
| Notifications can be restored as enabled without browser permission                                                                   | 6    |

## Step 1: destroy and the delta sync fix

Done, committed in `c820bef2`.

- [x] `CrdtDocStore.destroy()` and `destroyLocalStore()`
- [x] Delta sync rebuild after destroy, with unit tests (`tests/unit/destroyStore.test.ts`)
- [x] Destroy in Settings, with its confirmation dialog
- [ ] By hand, against a real S3 bucket and WebDAV folder: upload, destroy, download, edit, and check that a second device receives the edit. The unit tests use an in-memory remote store.
- [ ] By hand, the dialog: without sync, with a second tab open, and the ledger reload afterwards

## Step 2: version modules

Done. No change in behaviour. It comes before the later format changes, so that they are not made in code that is about to be split.

- [x] Sample files of versions 1 and 2, made before the refactoring (`tests/data/backup/`, checked by `tests/unit/backupSamples.test.ts`)
- [x] Split reading by version, with one writer and one apply (`src/lib/services/backup/`)

## Step 3: scheduled-transaction history in backups

Done.

Restoring the current list and then syncing can put wrong data on other devices. In a temporary test of restoring a list and then syncing, 22 of 40 runs ended with an old version and a deleted entry. With saved state, all 40 ended current.

- [x] Set the backup version to 3 (see above), with its reader
- [x] A backup saves the scheduled transactions as Yjs state, as it does the working set
- [x] Restoring saved state merges it (`importState`)
- [x] Files that hold only a list can still be restored. Their merge-only behaviour comes in step 5
- [x] Keep the warning for lists only: update the Destroy dialog and the Settings help, which now apply it to every backup
- [x] Tests: back up, destroy, restore, sync, with later edits and deletions
- [x] A damaged saved state is rejected when the file is read, before anything is written

## Step 4: safety fixes

Done.

- [x] WebDAV and Peer Sync use the safe settings export and import, also in the merge, preview and comparison views
- [x] Checks before a settings upload and import
- [x] A backup rule for every key, declared key types for `set()`, `userBookFilename` added to `SettingKeys`. The rules say what is backed up now; step 6 changes them
- [x] Rename `getAll()` to `getAllWithSecrets()`
- [x] Comments on the importer configs about secrets, with tests (`tests/unit/importerConfigSecrets.test.ts`)
- [ ] By hand: upload, diff, preview and download settings over WebDAV, and pull and merge them over Peer Sync

## Step 5: restore fixes

For older files too.

- [ ] Merge only; lists add the missing entries and delete nothing
- [ ] Destroy on the restore page, reusing the dialog
- [ ] Preview of added, changed and deleted records; report a restore that adds nothing
- [ ] Remove `fileSyncInitializedAt` from restored trusted devices
- [ ] Record the previous device only on a device that has never synced

## Step 6: consolidated format

- [ ] The four groups, with Credentials independent of the others
- [ ] Whole connections; whole-value secrets; the proxy becomes one setting, with a migration
- [ ] The missing settings and credentials
- [ ] The whole-value secret rule, and the rules of the keys that start to be backed up
- [ ] No folder names; notification permission rule
- [ ] Update the older comments that say credentials are never exported
- [ ] Compression, and measure what it saves
- [ ] Test sharing a compressed file on a phone
- [ ] Recognize compression, encrypted credentials and contents; grey out what a file lacks
- [ ] A sample file of version 3, once the format is final

## Step 7: onboarding and documentation

- [ ] **Restore from backup** in onboarding
- [ ] Restore warnings and explanations in the help pages
- [ ] Review the design document against what was built

## Step 8: align sync with backup

After backup is consolidated.

- [ ] Review what each channel offers and where wording, options and behaviour differ. The WebDAV sync page, for example, offers settings and the two transaction stores, and no Beancount files were found there
- [ ] Settle whether This device is synced
- [ ] Plan the changes from the review
