# Remove the OPFS `cashier.bean` Code

## Goal

Delete all code that reads, writes or refers to a real `cashier.bean` file in OPFS. The working set now lives only in the CRDT store (see [better-sync](2026-09-25_better-sync.md)), and the migration from the file is complete.

## Out of Scope

The ledger loading stays as it is. The worker still receives the working set as Beancount text (`XactStore.toBeancount()`), registers it under a virtual file name and folds it into the user's book with an in-memory `include`, so the book's `option` directives stay authoritative. Only the OPFS file and the legacy store behind it are removed.

## Assumptions

- Every device has already migrated to the CRDT store. There is no fallback afterwards: a device with only a `cashier.bean` would start with an empty working set.
- Any old `cashier.bean` files left on WebDAV are ignored.

## Tasks

### 1. Storage layer

- [ ] Delete `src/lib/storage/opfsXactStore.ts` and `tests/unit/opfsXactStore.test.ts`.
- [ ] `xactStoreRegistry.ts`: remove `defaultKind()`, the `fileExists` check and the OPFS fallback. `resolveStore()` returns a `CrdtXactStore`; the dynamic import can become static. Rewrite the doc comment.
- [ ] Decide whether the `xactStore` device setting is still needed. If not, remove it from `settings.ts` and the registry test.
- [ ] `xactStore.ts`: narrow or remove `kind: 'opfs' | 'crdt'`. Then the `kind === 'crdt'` checks in `peerConnection.svelte.ts` and `webdavAutoBackupService.ts` become unconditional. If `kind` goes, the interface may need the CRDT-only methods (e.g. `exportState`).
- [ ] Update `xactStoreRegistry.test.ts` and the `{ kind: 'opfs' }` mock in `webdavAutoBackupService.test.ts`.

### 2. WebDAV

- [ ] `webdavAutoBackupService.ts`: delete the legacy `readFile('cashier.bean')` / `put` / `lastModified` branch. Keep only the `.ydoc` path. Fix the header comment.
- [ ] `routes/backup/webdav/+page.svelte`: remove every `isCrdt` branch and its `!isCrdt` alternative, the `'cashier.bean'` label and the `lastModified('cashier.bean')` call. Rename `includeCashierBean` and the `'bean'` query parameter (e.g. to "transactions"), and check that the `diff` and `preview` routes accept the new name.
- [ ] `routes/settings/webdav-cfg/+page.svelte`: remove the `cashier.bean` upload and download filenames and the "phone uploads cashier.bean" workflow text. First check whether the page has upload/download features that only exist for this file.
- [ ] `utils/webNotification.ts`: change the "cashier.bean has been uploaded" message.
- [ ] `settings.ts`: fix the auto-upload comment.

### 3. Other OPFS paths

- [ ] `constants.ts`: delete `CASHIER_XACT_FILE` once unused. `ledgerWorkerClient.ts` still uses it as the virtual file name (`mainFileName`); give that its own name that says it is virtual (e.g. `DEVICE_XACTS_FILE`).
- [ ] `utils/opfsExport.ts`: remove the allow-list entry.
- [ ] `routes/opfs/import-ledger/+page.svelte`: remove the `CASHIER_XACT_FILE` skip.
- [ ] `routes/export/[dataType=exportType]/+page.svelte`: check the share-file name.
- [ ] `routes/opfs/export-ledger/+page.svelte`: remove the "on-device transaction store" copy and the retry-on-missing-file workaround.
- [ ] `routes/settings/+page.svelte`: remove the `xactStoreType` / `loadedXactStoreType` selector, the "OPFS (cashier.bean file, legacy)" option and the "Save book filename in cashier.bean" comment.
- [ ] `data/initializer.ts` and `services/appService.ts`: remove the create-empty-`cashier.bean` function and, if present, `stripIncludesFromBookFile()` / `saveCashierFile()`. Find all callers first.
- [ ] Comment-only fixes: `demoDataService.ts`, `entitySearchService.ts`, `journal/+page.svelte`, `DiffViewer.svelte`.
- [ ] `utils/keyedMerge.ts`: it was written for merging `cashier.bean` lines. Check whether it is still used; delete it if not.

### 4. Docs

- [ ] `doc/architecture.md`: rewrite the "What `cashier.bean` means now" section and the store table.
- [ ] Help docs: `beancount-sync.md`, `ledger-export.md`, `peer-sync.md`, `webdav-backup.md`, `transaction-detail.md`.
- [ ] `.agents/skills/rledger/SKILL.md`, `AGENTS.md` ("Stored in `cashier.bean`"), `TODO.md`.
- [ ] Mark the "Other code paths" item in the better-sync doc as done.
- [ ] Update the `cashier-bean-root-file-architecture` memory note.

## Verification

- `rg "cashier\.bean|CASHIER_XACT_FILE|OpfsXactStore"` returns only intended leftovers (the virtual name, historical docs in `completed-projects/`).
- `npm run verify` (lint, check, unit tests, e2e tests), run by the user.
- Manual: WebDAV backup and merge on the CRDT store, peer sync, ledger reload with and without a user book.

## Suggested Order

1. Storage layer and WebDAV (tasks 1 and 2), since the other paths depend on them.
2. Other OPFS paths (task 3).
3. Docs (task 4).
