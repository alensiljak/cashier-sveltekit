# Beancount File Sync (Generic, Two-Peer)

## Goal

Cashier as source of truth requires syncing the full Beancount book (not just
`cashier.bean`) between two peers. Make the sync engine source-agnostic
(OPFS / native filesystem / remote peer) so today's peer-sync work can later
absorb `opfs/sync` (FS↔OPFS) onto the same code path.

## Current State (as of investigation)

Two narrow, unrelated sync surfaces exist:

| Page        | Transport                                      | Scope                                                            | Baseline                                                                                                      | Diff                                                                   |
| ----------- | ---------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `opfs/sync` | File System Access API (`showDirectoryPicker`) | one local dir ↔ OPFS                                             | `importManifest.ts` — raw IndexedDB (not Dexie), single global `{path,size,lastModified,importedAt}` baseline | none — flat table, metadata-only, no tree, no content preview          |
| `peer-sync` | `trystero` (WebRTC)                            | hardcoded 3 items: `cashier.bean`, settings JSON, scheduled JSON | none — always fetches full remote snapshot                                                                    | yes, via `diff` pkg, but pull-only, no baseline-aware change detection |

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

### Scope — which files sync

- Glob: `*.bean, *.toml` (same default as `opfs/sync`'s `fileSpec`), excluding `.cashier/` (internal cache) and the top-level `cashier.bean` staging file.
- `cashier.bean` stays excluded, same precedent as `opfsExport.ts`: it holds device-local pending transactions ("quick transaction entry"), and merging two devices' pending queues is a line-level append/merge problem, not a file-replace. Out of scope here; revisit separately if cross-device pending-entry merge is ever needed.

### UI

- New route (source-agnostic engine, so live at top level): `src/routes/sync/beancount/+page.svelte`, taking a peer id.
- Tree UI extends `OpfsFilePicker.svelte`'s flat depth-indented list (closest reusable shape — already carries path/size/lastModified/expanded) with a per-row status pill (unchanged / local-newer / remote-newer / conflict) and a per-row direction toggle (mirrors `opfs/sync`'s `cycleAction`).
- Conflict rows get a manual "Verify" action: calls `hashFile(path)` on both sources. Matching hashes downgrade the row to unchanged/skip and refresh the baseline without a content pull; a mismatch keeps it a conflict pending a manual diff/direction decision.
- Per-file "preview diff" reuses `buildDiffLines`, extracted into `src/lib/utils/diffText.ts` (dedup of the `peer-sync`/`backup/webdav/diff` copies).
- `peer-sync/+page.svelte` stays as pure identity/pairing: device name, room code, device ID, trusted-peers list. Strip its current sync-panel/preview/diff/pull modals; the "Sync from" action on a trusted peer links into `/sync/beancount?peer=<id>` instead.
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
- [ ] Create `src/lib/sync/` with `SyncSource` interface and `SyncEntry` type
- [ ] Implement `OpfsSource`, including `hashFile(path)` via `crypto.subtle.digest('SHA-256', …)` over the file's own content
- [ ] Add Dexie `syncBaseline` table (new db version), keyed `[endpointId+path]`
- [ ] Implement diff classification (`pull`/`conflict`/`skip`) against baseline

### Peer Protocol

- [ ] Implement `list-files`/`read-file`/`hash-file` trystero actions using `kind:'request'`, replacing `sync-request`/`sync-response` and the hand-rolled `pendingRequests` map
- [ ] Trust-check each `onRequest` handler against `TrustedPeer`
- [ ] Implement `PeerSource` on top of the generalized protocol

### UI

- [ ] Build `src/routes/sync/beancount/+page.svelte`: tree view (extend `OpfsFilePicker.svelte`), per-row status + direction toggle (pull/skip only), apply action — **layout + peer selection done**: static mock data, tree collapse/expand, status pills, direction toggle all clickable; diff/verify/apply buttons present but disabled pending the sync engine. No-peer-selected states now wired: no trusted peers → link to `/peer-sync` setup; trusted peers exist → joins the room and lists them for single-selection, each with a live connection dot (green=online/red=offline/yellow=connecting during the post-join discovery window). Room join/identity/trust logic extracted into shared `src/lib/sync/peerPresence.svelte.ts` (`PeerPresence`), also now used by `peer-sync/+page.svelte`. Nav entry added under Data.
- [ ] Wire per-file diff preview using the shared diff util
- [ ] Wire the conflict-row "Verify" action: `hashFile(path)` on both sources, downgrade to unchanged/skip on match, else keep as conflict
- [ ] Strip sync-panel/preview/diff/pull UI out of `peer-sync/+page.svelte`, replace "Sync from" with a link into the new page
- [ ] Update baseline (`syncBaseline` table) after each applied sync

### Verification

- [ ] Manual two-browser-instance smoke test: pull direction, conflict row, hash-verify match and mismatch
- [ ] `npm run check` / `npm run lint` clean
