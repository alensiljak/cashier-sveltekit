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

### Phase 1: Move logic out of the pages

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

### Phase 2: A common channel interface

1. [ ] Define `SyncChannel` in `src/lib/sync/channel.ts`:

   ```ts
   interface SyncChannelStatus {
   	lastSync: Date | null;
   	pending: number; // uploads + downloads
   	conflicts: number;
   	error?: string;
   }
   interface SyncChannel {
   	id: 's3' | 'webdav' | 'peer' | 'beancount';
   	label: string;
   	isEnabled(): boolean; // from syncOptions
   	isConfigured(): boolean;
   	status(): Promise<SyncChannelStatus>;
   	syncNow?(): Promise<void>; // omitted where a sync needs user decisions
   	href: string;
   }
   ```

2. [ ] Adapters per channel, reusing existing calls: `getLastSync`, `fetchRemoteOverview`, `fetchFileSyncStatus` for S3; the equivalents in `webdavDelta.ts`; `peerConnection` and `peerPresence` for peers; the sync diff for Beancount files.
3. [ ] A registry (`getChannels()`) filtered by `syncOptions`.
4. [ ] Unit tests for each adapter against stubbed stores.

Open point: `status()` must be cheap and must not trigger network traffic on hub load unless the user asks. Prefer cached "last known" state, with an explicit refresh.

### Phase 3: The `/sync` hub

1. [ ] `/sync/+page.svelte`: one [SyncCard.svelte](/src/lib/components/SyncCard.svelte) per enabled channel, showing last sync, a pending/conflict badge, an error line, "Sync now" (where offered) and a link to the detail page.
2. [ ] A staleness warning at the top when no channel has synced within a configurable period, and a prompt to set one up when none is configured.
3. [ ] A "Backup file" section for the offline export and restore fallback.
4. [ ] Collapse the sync/backup entries in [navigation.svelte](/src/lib/components/navigation.svelte) into a single "Sync" entry. The `syncOptions` toggles still decide which cards appear.
5. [ ] Update the Settings page links ([settings/+page.svelte](/src/routes/settings/+page.svelte)) to point at the hub.

### Phase 4: Move pages under `/sync`

1. [ ] Move the route folders per the target structure above, one channel per commit.
2. [ ] Add redirects from the old paths (a `+page.ts` with `redirect(308, ...)`, or `+layout`-level handling).
3. [ ] Update internal links, including `SyncCard.svelte`, `peer-sync/+page.svelte`, `pullFiles.ts`, `PeerSource.ts` and `OpfsSource.ts` (these reference the old paths), plus any e2e tests and the help content.
4. [ ] Update `doc/architecture.md` and the user docs.

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
