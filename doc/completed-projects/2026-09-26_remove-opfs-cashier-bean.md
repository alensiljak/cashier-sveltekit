# Remove the OPFS `cashier.bean` Code

## Goal

Delete all code that reads, writes or refers to a real `cashier.bean` file in OPFS. The working set now lives only in the CRDT store (see [better-sync](2026-09-25_better-sync.md)), and the migration from the file is complete.

## Out of Scope

The ledger loading stays as it is. The worker still receives the working set as Beancount text (`CrdtXactStore.toBeancount()`), registers it under a virtual file name and folds it into the user's book with an in-memory `include`, so the book's `option` directives stay authoritative. Only the OPFS file and the legacy store behind it are removed.

## Assumptions

- Every device has already migrated to the CRDT store. There is no fallback afterwards: a device with only a `cashier.bean` would start with an empty working set.
- Any old `cashier.bean` files left on WebDAV are ignored.

## Tasks

### ✅ 1. Storage layer

- [x] Delete `src/lib/storage/opfsXactStore.ts` and `tests/unit/opfsXactStore.test.ts`.
- [x] `xactStoreRegistry.ts`: remove `defaultKind()`, the `fileExists` check and the OPFS fallback. `resolveStore()` returns a `CrdtXactStore`. The import stays dynamic: a static one would be circular (crdtXactStore → webdavAutoBackupService → registry). Rewrite the doc comment.
- [x] Remove the `xactStore` device setting from `settings.ts` and the registry test.
- [x] `xactStore.ts` (the `XactStore` interface) removed; `XactId` and `StoredXact` moved into `crdtXactStore.ts`. `getXactStore()` returns a `CrdtXactStore`, so the `kind` checks and `as CrdtXactStore` casts are gone (peer sync, auto-backup, demo data, `YdocDevices`).
- [x] Updated `xactStoreRegistry.test.ts` (CRDT store, shared instance, `setXactStore`, `subscribeXactStore`) and `webdavAutoBackupService.test.ts` (single upload path, mock store has only `exportState`).

### ✅ 2. WebDAV

- [x] `webdavAutoBackupService.ts`: delete the legacy `readFile('cashier.bean')` / `put` / `lastModified` branch. Keep only the `.ydoc` path. Fix the header comment. Also removed `updateCashierBeanBaseline`, `contentHash`, `SyncRecord` and the `cashierBean` baseline field.
- [x] `routes/backup/webdav/+page.svelte`: `isCrdt` branches, the `cashier.bean` label and the hash-based baseline removed; `includeCashierBean` renamed `includeXacts`. Local Transactions are not sent to the `diff` and `preview` routes (a binary Yjs file), so their `bean` handling was deleted.
- [x] `routes/settings/webdav-cfg/+page.svelte`: the Upload (PUT) and Download (GET) cards are generic test tools for any file name, so they stay; their default name is now `test.txt`. The "phone uploads cashier.bean" workflow bullet is removed.
- [x] `utils/webNotification.ts`: change the "cashier.bean has been uploaded" message.
- [x] `settings.ts`: fix the auto-upload comment.

### ✅ 3. Other OPFS paths

- [x] `constants.ts`: `CASHIER_XACT_FILE` replaced by `DEVICE_XACTS_FILE`, used by `ledgerWorkerClient.ts` as the virtual file name (`mainFileName`). Its value stays `cashier.bean`, so a stray real file of that name is still overridden by the working set.
- [x] `utils/opfsExport.ts`: removed the allow-list entry (and updated its test). A stray `cashier.bean` left in OPFS is now exported like any other file.
- [x] `routes/opfs/import-ledger/+page.svelte`: remove the `CASHIER_XACT_FILE` skip.
- [x] `routes/export/[dataType=exportType]/+page.svelte`: the name was only used for the `canShare` capability probe; it is now `journal.bean`.
- [x] `routes/opfs/export-ledger/+page.svelte`: remove the "on-device transaction store" copy and the retry-on-missing-file workaround.
- [x] `routes/settings/+page.svelte`: remove the `xactStoreType` / `loadedXactStoreType` selector and the "OPFS (cashier.bean file, legacy)" option.
- [x] `routes/settings/+page.svelte`: fix the "Save book filename in cashier.bean" comment.
- [x] `data/initializer.ts` and `services/appService.ts`: `createDefaultCashierFile()` only called `store.initialize()`, which the CRDT store still needs, so it is renamed `initializeXactStore()` (callers: `initializer.ts` and three in `onboarding/+page.svelte`). No `stripIncludesFromBookFile()` / `saveCashierFile()` exist. Header comments rewritten.
- [x] Comment-only fixes (also `constants.ts`, `ledger.worker.ts`): `demoDataService.ts`, `entitySearchService.ts`, `journal/+page.svelte`, `DiffViewer.svelte`.
- [x] `utils/keyedMerge.ts`: still used (`JsonMergeViewer`, peer-sync settings merge), so it stays; only its header comment is fixed.

### ✅ 4. Docs

- [x] `doc/architecture.md`: the store table and the "What `cashier.bean` means now" section are replaced by a CRDT-only Working Set Store section, with how the working set reaches the WASM engine. Also removed the references to the light `ledgerService`, which no longer exists, and rewrote the reload section around `subscribeXactStore`.
- [x] Help docs: `beancount-sync.md`, `ledger-export.md`, `peer-sync.md`, `webdav-backup.md`, `transaction-detail.md`.
- [x] `.agents/skills/rledger/SKILL.md`, `AGENTS.md` ("Stored in `cashier.bean`"), `TODO.md`.
- [x] Mark the "Other code paths" item in the better-sync doc as done.
- [x] Update the `cashier-bean-root-file-architecture` memory note.

## Verification

- `rg "cashier\.bean|CASHIER_XACT_FILE|OpfsXactStore"` returns only intended leftovers (the virtual name, historical docs in `completed-projects/`).
- `npm run verify` (lint, check, unit tests, e2e tests), run by the user.
- Manual: WebDAV backup and merge on the CRDT store, peer sync, ledger reload with and without a user book.

## Suggested Order

1. Storage layer and WebDAV (tasks 1 and 2), since the other paths depend on them.
2. Other OPFS paths (task 3).
3. Docs (task 4).
