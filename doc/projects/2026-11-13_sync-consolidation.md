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
2. [ ] **Split `s3Sync.ts`** along its existing seams, keeping `s3Sync.ts` as a re-exporting barrel at first so callers do not change:
   - session and `runSync` -> `s3Session.ts`
   - CRDT store sync and diagnostics (`backupCrdtStores`, `syncCrdtStores`, `diagnoseCrdt`, `previewCrdtChanges`, compaction, device forgetting) -> `s3CrdtSync.ts`
   - remote overview, bucket devices, last sync -> `s3Status.ts`
   - per-file status and compare (`listFileStatuses`, `compareFile`, `compareSettings`, `markSameContent`) -> `s3FileCompare.ts`
   - Then update callers to import from the specific module and drop the barrel.
3. [ ] **Other oversized pages.** Check `/peer-sync` (~800 lines), `/backup/s3` (~660) and `/opfs/import-ledger` (~770) for inline orchestration. Extract only where it is real logic, not markup.
4. [ ] **Tests.** Unit tests for the extracted controller and the pure S3 modules. Record any gap that needs real S3 or peers as an e2e candidate, not a mock-heavy unit test.

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
