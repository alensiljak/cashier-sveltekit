# Sync Consolidation

Goal: one "Sync" hub that shows the state of every sync channel, and a code structure in which the sync logic lives in testable modules rather than in route pages.

Origin: "Consolidate the sync surface" in [2026-11-09_account-reconciliation.md](2026-11-09_account-reconciliation.md).

## Problem

Sync and backup are spread over four route trees and about 20 pages, with no single place that answers "is my data safe and current?".

| Channel         | Pages                                           | Logic                                                                                      |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Backup file     | `/backup`                                       | `backupService.ts`                                                                         |
| S3              | `/backup/s3`, `/files`, `/records`, `/settings` | `s3Sync.ts` (~1,300 lines), `s3SyncPlan.ts`, `s3RemoteStore.ts`                            |
| WebDAV          | `/backup/webdav`, `/diff`, `/preview`           | `webdavDelta.ts`, `webdavRemoteStore.ts`, `webdavAutoBackupService.ts`                     |
| Peer            | `/peer-sync`, `/peer-sync/setup`, `/pair`       | `lib/sync/*` (`peerConnection`, `pairing`, `peerPresence`, ...)                            |
| Beancount files | `/sync/beancount`, `/opfs/sync`                 | `PeerSource.ts`, `OpfsSource.ts`, `syncDiff.ts`, `pullFiles.ts`, mostly inline in the page |

Consequences:

- The largest files are sync code: `s3Sync.ts` and [sync/beancount/+page.svelte](/src/routes/sync/beancount/+page.svelte) (~1,170 lines, with the orchestration inline).
- Page-embedded logic cannot be unit-tested.
- The navigation has a separate entry per channel (toggled by `syncOptions`) and no overview.

## Decisions

- The hub lives at `/sync`.
- Pages may move under `/sync/...` where that gives a coherent structure. Old paths get redirects so bookmarks, PWA shortcuts and e2e tests keep working until they are updated.
- Order of work: code split first (no behaviour change), then the channel abstraction, then the hub, then the page moves.

## Target structure

```
/sync                 hub: one card per enabled channel
/sync/s3              (was /backup/s3, plus files, records, settings below it)
/sync/webdav          (was /backup/webdav)
/sync/peer            (was /peer-sync, with setup)
/sync/beancount       existing
/sync/backup-file     (was /backup)
```

`/opfs/sync` and `/pair` are decided in phase 5; they may fold into the above.

## Phases

### ✅ Phase 1: Move logic out of the pages

No behaviour change. Each step is its own commit, with unit tests for whatever becomes pure.

1. ✅ **Beancount sync controller.** Extract `loadLocalTree`, `refreshPeer`, `refreshAll`, `markSynced`, `applyChanges`, `openDiffFor`, `markDiffModalIdentical` and `applyMergeForModal` from [sync/beancount/+page.svelte](/src/routes/sync/beancount/+page.svelte) into a `.svelte.ts` controller (or a plain service plus a state class). The page keeps only markup and event wiring.
2. ✅ **Split `s3Sync.ts`** (1,311 lines) along its existing seams. `s3Sync.ts` is now a 72-line re-exporting barrel, so no caller changed. There was no module-level mutable state, only constants.
   - `s3Session.ts` (200): types, bucket layout constants, key and manifest loading, `openSession`, `persist`, last-sync bookkeeping
   - `s3Files.ts` (330): settings and Beancount file sync, `runSync`, `resolveConflict`, `applyMerge`, `applyDeletion` (`runSync` lives here, not in the session, because it needs both files and CRDT stores)
   - `s3CrdtSync.ts` (423): CRDT store sync, status, previews, diagnostics, compaction, forgetting a device
   - `s3FileCompare.ts` (224): `listFileStatuses`, `compareFile`, `compareSettings`, `markSameContent`, `fetchFileSyncStatus`
   - `s3Status.ts` (135): `fetchRemoteOverview`, `listBucketDevices`
   - `s3Preview.ts` (66): `previewObject`
   - [ ] Follow-up: update callers to import from the specific module and drop the barrel.
3. ✅ **Other oversized pages.** Extracted only real logic, not markup:
   - `/backup/s3` -> [s3StatusView.ts](/src/lib/services/s3StatusView.ts): badge, available actions, gaps, item description, "does this touch the ledger", "was the run clean". The hub's S3 card in Phase 3 can reuse `badgeFor` and `actionsFor`.
   - `/opfs/import-ledger` -> [importScan.ts](/src/lib/utils/importScan.ts): file classification against the manifest, deletion detection, copy and delete selection, the manifest rebuild plan.
   - `/peer-sync`: left as is. The script is mostly async glue over `peerConnection` with stale-peer guards, and the only pure parts are tiny (`itemHashStatus`, the file-diff summary). The peer channel adapter in Phase 2 will need the same status calculation, so extract it there.
4. ✅ **Tests.** [syncTree.test.ts](/tests/unit/syncTree.test.ts) (14), [s3StatusView.test.ts](/tests/unit/s3StatusView.test.ts) and [importScan.test.ts](/tests/unit/importScan.test.ts) (33 between them).
   - Not covered: the S3 session and sync core (`syncShared`, `persist`, `canonical`, `classify`) need `s3Client` and OPFS mocks. `canonical` and `classify` are pure but unexported or file-private; export them for tests when touching that code next, and leave the I/O paths to an e2e test with a real or emulated bucket.
   - Not covered: `BeancountSyncController` itself (peer I/O and reactive state). Its pure parts are covered through `syncTree.ts`.

### ✅ Phase 2: A common channel interface

Design, decided while implementing (differs from the first sketch):

- The channels are the three that already have a headless check and sync and are shown on the home Sync card: **WebDAV, S3 and P2P**, all for the CRDT stores. File-level Beancount sync (`/sync/beancount`, `/opfs/sync`) needs a peer scan and user decisions per file, so it is not a channel; the hub links to it instead.
- **Status is cached, not fetched.** `SyncHub` keeps the last known status in memory. Opening the hub or the card contacts nothing. A channel is contacted only by `check(id)`, `sync(id)`, or an explicit `checkAll()`. Last-sync times are persisted (`DeviceSettingKeys.syncChannelLastSync`, plus S3's own `s3LastSync`), so they survive a restart; the status itself starts as "not checked".
- The hub reports outcomes instead of showing notifications. The UI decides how to present them.

1. ✅ [channel.ts](/src/lib/sync/channel.ts): `SyncChannel` (`check`, `sync`, `isEnabled`, `unavailableReason`, optional `lastSync`), `ChannelSnapshot`, and the pure rules `isStale` / `overallState` (`none`, `error`, `attention`, `ok`, `stale`; default staleness 7 days) / `newestSync`.
2. ✅ [channels.ts](/src/lib/sync/channels.ts): adapters wrapping the same calls the home card used (`checkWebDav` / `syncWebDav`, `checkCrdtStores` / `syncCrdtStores`, the peer Ydoc hash comparison and `syncYdoc`). Services are imported on use.
3. ✅ [syncHub.svelte.ts](/src/lib/sync/syncHub.svelte.ts): the cached state class, with channels and storage injected. The app's instance is [hub.ts](/src/lib/sync/hub.ts) (reloads the ledger after a merge).
4. ✅ [SyncCard.svelte](/src/lib/components/SyncCard.svelte): the WebDAV and S3 rows now use the hub, so the home card and the `/sync` page will show the same cached status. The P2P row keeps its own per-device comparison for now.
5. ✅ [syncHub.test.ts](/tests/unit/syncHub.test.ts): 26 tests with fake channels (no services, network or storage).
6. [ ] Follow-up: move the P2P row of the home card onto the hub's peer channel. Needs a per-peer breakdown in the snapshot, which Phase 3's hub page wants anyway.
7. [ ] Follow-up: a channel-level "pending counts" view (files to upload or download, conflicts). The hub currently knows only same/differs; richer detail stays on the channel's own page (`s3StatusView.ts`).

### ✅ Phase 3: The `/sync` hub

1. ✅ [/sync/+page.svelte](/src/routes/sync/+page.svelte): one card per enabled channel, driven by `syncHub` (not a copy of the home SyncCard, which stays the compact home version). Each shows the cached status badge, last sync ("x ago" plus the date), when it was checked, an error or "unavailable" reason, **Check**, **Sync now**, and **Details**. A **Check all** button contacts every reachable channel. Opening the page only reads local state (`syncHub.load()`); it contacts no channel.
2. ✅ Overall banner from `syncHub.overall`: no channels (links to Settings), failed, changes to exchange, stale (default: nothing synced for a week), or up to date with the newest sync time. The period is the fixed `DEFAULT_STALE_MS` for now; making it a setting is a follow-up.
3. ✅ "More" section with links to Beancount file sync (when peer sync is on), the backup file page, and the sync options in Settings. The backup page itself stays a separate page.
4. ✅ [navigation.svelte](/src/lib/components/navigation.svelte): the Backup & Sync group now starts with **Sync**; the separate WebDAV Backup, S3 Sync and Peer Sync entries are gone (the hub's cards link to them). Backup and the two explorers stay.
5. ✅ Settings' Backup & Sync card now points at the hub. [hubActions.ts](/src/lib/sync/hubActions.ts) holds the check/sync notices shared by the card and the page.
6. [ ] Follow-up: make the staleness period a setting.
7. [ ] Follow-up: an e2e test that opens `/sync` on demo data (no options enabled: shows the "No sync options" banner) and follows a link.

### ✅ Phase 4: Move pages under `/sync`

1. ✅ Moved the route folders per the target structure above (`/sync/s3`, `/sync/webdav`, `/sync/peer`, `/sync/backup-file`).
2. ✅ No redirects: the old paths were removed outright (decision: the app is not public enough for bookmarks to matter, and the PWA manifest and service worker held no references).
3. ✅ Internal links, comments and the e2e test updated.
4. ✅ `doc/architecture.md` and `doc/s3-sync.md` updated. Help topics keep their `/help/peer-sync` slug.

### Phase 5: Optional, merge the file-sync pages

`/sync/beancount` and `/opfs/sync` both diff and pull files, using `PeerSource` and `OpfsSource` over the shared `syncDiff.ts` and `pullFiles.ts`. Evaluate one page with a source selector. Do this only after phases 1–4, and only if the two pages still look redundant after the controller extraction.

## Risks

- **Peer sync state.** `peerConnection` is a long-lived singleton, and moving its pages must not drop the connection or presence indicator (the nav shows it).
- **Redirect coverage.** Old URLs may be stored in the PWA manifest shortcuts, the service worker or help text. Grep for them before removing the redirects.
- **S3 split.** `s3Sync.ts` has internal shared state (session caching). Check for module-level variables before splitting, so two modules do not end up with separate copies.
- **Hub performance.** Status checks across several remote channels must be lazy and cancellable.

## Verification

- Unit tests per phase as listed above.
- Phase 3 and 4: an e2e test that opens `/sync` on demo data and follows a card link, plus one that checks an old path redirects.
- The user runs `npm run verify` after each phase.

## Out of scope

- Changing the sync protocols, encryption or CRDT behaviour.
- New sync channels.
- The Periodic Background Sync idea for reminders.
