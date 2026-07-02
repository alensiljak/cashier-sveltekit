# Beancount File Sync (Generic, Two-Peer)

## Goal

Cashier as source of truth requires syncing the full Beancount book (not just
`cashier.bean`) between two peers. Make the sync engine source-agnostic
(OPFS / native filesystem / remote peer) so today's peer-sync work can later
absorb `opfs/sync` (FS↔OPFS) onto the same code path.

## Current State (as of investigation)

Two narrow, unrelated sync surfaces exist:

| Page        | Transport                                                           | Scope                                                            | Baseline                                                                                                      | Diff                                                                   |
| ----------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `opfs/sync` | File System Access API (`showDirectoryPicker`)                      | one local dir ↔ OPFS                                             | `importManifest.ts` — raw IndexedDB (not Dexie), single global `{path,size,lastModified,importedAt}` baseline | none — flat table, metadata-only, no tree, no content preview          |
| `peer-sync` | `@trystero-p2p/*` (WebRTC; Nostr/MQTT/BitTorrent relay, switchable) | hardcoded 3 items: `cashier.bean`, settings JSON, scheduled JSON | none — always fetches full remote snapshot                                                                    | yes, via `diff` pkg, but pull-only, no baseline-aware change detection |

## Design

### Generic sync engine — `src/lib/sync/`

- `SyncSource` interface: `listTree(): Promise<SyncEntry[]>`, `readFile(path)`, `writeFile(path, content)`, `deleteFile(path)`, `hashFile(path): Promise<string | undefined>`. `writeFile`/`deleteFile` apply an accepted pull locally — only `OpfsSource` needs a working implementation in v1; `PeerSource`'s stay unimplemented until push ships (see Future below).
  - `OpfsSource` — wraps `opfslib.ts`.
  - `PeerSource` — wraps generalized trystero actions (below).
  - `FileSystemSource` — wraps `fsScan.ts`/`fsHandleStore.ts`. Deferred; lets `opfs/sync` migrate onto this engine later.
- `SyncEntry`: `{path, size, lastModified}` — metadata-only, never a hash; hashing stays out of the tree scan. `hashFile(path)` is on-demand per path and always runs on the device hosting the file (SHA-256 via Web Crypto over the file's own content), so a peer only ever returns a digest, never the file content, to verify a match.
- Diff classification against baseline → `'pull' | 'conflict' | 'skip'` per path in v1 (download-only; renames `opfs/sync`'s fs/opfs-specific `SyncAction` to source-agnostic terms). `'push'` is reserved for a later phase — see Future below. Classification stays metadata-only — hashing is **not** run automatically on every conflict, only on explicit user action (see UI below).
- Baseline: new **Dexie** table (not another raw-IndexedDB store), keyed `[endpointId+path]`: `{endpointId, path, size, lastModified, syncedAt}`. Keyed per endpoint (unlike singleton `importManifest`) since a device may sync with multiple peers.

### Trystero protocol generalization

Replace the 3-hardcoded-files protocol (`sync-request`/`sync-response`) with `kind:'request'` trystero actions, all trust-checked against `TrustedPeer` before responding. Three ship in v1 (`list-files`, `read-file`, `hash-file`); a fourth (`write-file`) is designed below but deferred — see Future below.

- `list-files` — request: none. response: `SyncEntry[]` for the ledger glob (reuse `fsScan.ts`'s `parseSpecs`/`matchesAny`, same `*.bean, *.toml` pattern as `opfs/sync`).
- `read-file` — request: `{path}`. response: `{content: string} | {missing: true}` (peer may have deleted the file since `list-files`).
- `hash-file` — request: `{path}`. response: `{hash: string} | {missing: true}`. The receiving peer computes the digest itself and returns only that — used to cheaply confirm whether a metadata-flagged conflict is a real content difference.
- `write-file` — deferred to a later phase (push, see Future below). Shape carried forward so adding it later doesn't require a protocol rework: request `{path, content: string | null}` (`null` = delete), response `{ok: true} | {ok: false, error: string}`.
- Use trystero's built-in request/response plumbing (`room.makeAction(name, {kind:'request', onRequest})`) instead of the hand-rolled `pendingRequests` map + manual 30s timeout.

### Relay strategy (signaling network) selection

Trystero's monolithic `trystero` package bundled every signaling backend (BitTorrent, Nostr, MQTT, Firebase) behind one import. Switched to the `@trystero-p2p/*` split (`core` + one package per strategy) so only the chosen strategy's client library loads. `PeerPresence.strategy: 'nostr' | 'mqtt' | 'torrent'` (Firebase not exposed) defaults to `nostr`, is persisted via `Settings.peerRelayStrategy`, and is dynamically imported inside `join()`. Both peers MUST pick the same strategy to discover each other — a separate signaling network per choice, not a fallback chain. Switching strategy live leaves and rejoins the current room. Exposed via a toolbar menu on `/sync/beancount`; `/peer-sync` doesn't have the switcher yet (same `PeerPresence`, so trivial to add later).

### Scope — which files sync

- Glob: `*.bean, *.toml` (same default as `opfs/sync`'s `fileSpec`), excluding `.cashier/` (internal cache) and the top-level `cashier.bean` staging file.
- `cashier.bean` stays excluded, same precedent as `opfsExport.ts`: it holds device-local pending transactions ("quick transaction entry"), and merging two devices' pending queues is a line-level append/merge problem, not a file-replace. Out of scope here; revisit separately if cross-device pending-entry merge is ever needed.

### UI

- New route (source-agnostic engine, so live at top level): `src/routes/sync/beancount/+page.svelte`, taking a peer id.
- Tree UI extends `OpfsFilePicker.svelte`'s flat depth-indented list (closest reusable shape — already carries path/size/lastModified/expanded) with a per-row status pill (unchanged / local-newer / remote-newer / conflict) and a per-row direction toggle (mirrors `opfs/sync`'s `cycleAction`).
- Conflict rows get a manual "Verify" action: calls `hashFile(path)` on both sources. Matching hashes downgrade the row to unchanged/skip and refresh the baseline without a content pull; a mismatch keeps it a conflict pending a manual diff/direction decision.
- Per-file "preview diff" reuses `buildDiffLines`, extracted into `src/lib/utils/diffText.ts` (dedup of the `peer-sync`/`backup/webdav/diff` copies).
- `peer-sync/+page.svelte` keeps its own identity/pairing UI **and** its existing cashier.bean/settings/scheduled-transactions sync panel (`sync-request`/`sync-response`, preview/diff/pull) — those three items live outside OPFS and are out of scope for the generic `SyncSource` engine (glob-based, OPFS-only). It gains one addition: a link below the existing sync options into `/sync/beancount?peer=<id>` for syncing the full ledger book.
- v1 is download-only: the direction toggle offers pull or skip per row; a conflict (both sides changed since baseline) can only be resolved by pulling (overwrite local) or skipping — never pushed to the peer.

### Migration of `opfs/sync`

Deferred. `opfs/sync` keeps its own FS↔OPFS code path for now; moving it onto `SyncSource`/`syncBaseline` happens later, once the peer engine is proven, to avoid churning the engine API while both consumers are written at once.

### Future: push (not in v1)

A client can currently only pull remote changes. Pushing (writing to a peer) is deferred but the design already carries it forward without rework: the `write-file` trystero action shape above, `SyncSource.writeFile`/`deleteFile` already exist generically, and confirmation would live on the **initiator** (the sender reviews the diff and clicks "push"; the receiving peer's `write-file` applies silently once the trust check passes — symmetric with how pull already works today, since unattended sync between a user's own paired devices is the primary use case). When push ships: wire `write-file` into `PeerSource`, add a `'push'` outcome to diff classification, and add the push option to the direction toggle.

## Task Tree

### Foundation

- [x] Declare `diff` as a direct dependency in `package.json` (bumped to v9, which bundles its own types; dropped the deprecated `@types/diff` stub)
- [x] Extract `buildDiffLines`/`DiffLine`/`DiffSection` into `src/lib/utils/diffText.ts`, update `peer-sync` and `backup/webdav/diff` to use it
- [x] Remove dead `StorageBackendType` export from `storageBackend.ts`
- [x] Create `src/lib/sync/` with a `SyncSource` interface (`SyncEntry` moved here from `OpfsSource.ts`)
- [x] Implement `OpfsSource` as a full `SyncSource` class (`listTree`/`readFile`/`writeFile`/`deleteFile`/`hashFile`), with `hashFile(path)` via `crypto.subtle.digest('SHA-256', …)` over the file's own content
- [x] Add Dexie `peerSyncBaseline` table (new db version), keyed `[endpointId+path]` (`src/lib/data/db.ts` v6, `PeerSyncBaseline` model, CRUD in `src/lib/sync/syncBaseline.ts`)
- [x] Implement diff classification (`pull`/`conflict`/`skip`) against baseline (`src/lib/sync/syncDiff.ts`'s `diffAgainstBaseline`); added `fake-indexeddb` devDependency + `tests/setup.ts` wiring so Dexie-backed modules are unit-testable

### Peer Protocol

- [x] Implement `list-files` as a `kind:'request'` trystero action via `PeerPresence.makeRequestAction`, trust-checked against `TrustedPeer` (untrusted callers get `[]`)
- [x] Implement `read-file`/`hash-file` the same way (used by `PeerSource`, below); `peer-sync/+page.svelte`'s own `sync-request`/`sync-response`/`pendingRequests` protocol is kept as-is — it syncs `cashier.bean`/settings/scheduled transactions, which are out of the generic engine's OPFS-only scope
- [x] Implement `PeerSource` on top of the generalized protocol — registers all three request actions (responder side, backed by a `SyncSource`) and issues them against a resolved target peer (querying side); `writeFile`/`deleteFile` throw until push ships

### Relay Strategy

- [x] Split the `trystero` dependency into `@trystero-p2p/{core,nostr,mqtt,torrent}`
- [x] Add `PeerPresence.strategy`, persisted via `Settings.peerRelayStrategy`, dynamically imported per strategy in `join()`
- [x] Toolbar menu on `/sync/beancount` to switch strategy (leaves + rejoins the room, re-registers `list-files`, forces a remote refetch)
- [x] Add the same strategy switcher to `/peer-sync`

### UI

- [ ] Build `src/routes/sync/beancount/+page.svelte`: tree view (extend `OpfsFilePicker.svelte`), per-row status + direction toggle (pull/skip only), apply action
  - [x] Peer selection: joins the room unconditionally on mount (gating on `trustedPeers.length > 0` broke discovery whenever trust wasn't yet mutual); 15s post-join discovery grace window (was 3s — real Nostr-relay joins can take longer) before an absent trusted peer reads as offline rather than connecting; no trusted peers → link to `/peer-sync`; trusted peers but none online → waiting spinner; peers online → single-select list with a live connection dot
  - [x] Real local + remote file listing: local via `OpfsSource.listTree()`, remote via `PeerSource.listTree()` (10s timeout); side-by-side table (name, local size/date, direction arrow, remote size/date)
  - [x] Room join/identity/trust logic extracted into shared `src/lib/sync/peerPresence.svelte.ts` (`PeerPresence`), also used by `peer-sync/+page.svelte`; nav entry added under Data
  - [x] Fixed peer-selection URL to build off `page.url.pathname` instead of a hardcoded relative path; added a global `window.onerror`/`unhandledrejection` logger in `+layout.svelte` to catch this class of silent failure earlier
  - [ ] Per-row status pill (unchanged / local-newer / remote-newer / conflict) and direction toggle — blocked on diff classification (Foundation) landing
  - [ ] Diff/verify/apply buttons — present in the layout, disabled pending the sync engine
- [ ] Wire per-file diff preview using the shared diff util
- [ ] Wire the conflict-row "Verify" action: `hashFile(path)` on both sources, downgrade to unchanged/skip on match, else keep as conflict
- [x] Added a link below `peer-sync/+page.svelte`'s existing sync options into `/sync/beancount?peer=<id>` for full ledger-file sync; the page's own cashier.bean/settings/scheduled sync panel is unchanged
- [ ] Update baseline (`syncBaseline` table) after each applied sync

### Verification

- [ ] Manual two-browser-instance smoke test: pull direction, conflict row, hash-verify match and mismatch
- [ ] `npm run check` / `npm run lint` clean
