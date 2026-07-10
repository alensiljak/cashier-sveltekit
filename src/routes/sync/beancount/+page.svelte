<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		FolderIcon,
		FolderOpenIcon,
		FileIcon,
		TriangleAlertIcon,
		Check,
		DownloadIcon,
		RefreshCwIcon,
		GitCompareArrowsIcon,
		ChevronDownIcon,
		ChevronRightIcon,
		FunnelIcon
	} from '@lucide/svelte';
	import { PeerSource } from '$lib/sync/PeerSource';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import Notifier from '$lib/utils/notifier';
	import { RELAY_STRATEGIES, type RelayStrategy } from '$lib/sync/peerPresence.svelte';
	import { peerConnection } from '$lib/sync/peerConnection.svelte';
	import { OpfsSource } from '$lib/sync/OpfsSource';
	import { normalizeEol, type SyncEntry } from '$lib/sync/SyncSource';
	import {
		diffAgainstBaseline,
		type DiffEntry,
		type SyncStatus,
		type SyncAction
	} from '$lib/sync/syncDiff';
	import {
		getBaseline,
		updateBaseline,
		removeBaselineEntries,
		type BaselineEntry
	} from '$lib/sync/syncBaseline';
	import DiffViewer from '$lib/components/DiffViewer.svelte';
	import type { PeerSyncBaseline } from '$lib/data/model';

	// ─── Peer selection & connection state ──────────────────────────────────────

	const presence = peerConnection.presence;
	const opfsSource = new OpfsSource();
	let presenceReady = $state(false);
	// Grace window after joining the room during which an absent trusted peer
	// still reads as "connecting" rather than "offline" (discovery isn't instant).
	let discoveryDone = $state(false);

	const urlPeerId = $derived(page.url.searchParams.get('peer') ?? '');
	let activePeerId = $state<string | null>(null);
	let activePeer = $derived(
		activePeerId ? (presence.trustedPeers.find((p) => p.id === activePeerId) ?? null) : null
	);
	let onlineTrustedPeers = $derived(
		presence.trustedPeers.filter((tp) => peerState(tp.id) === 'online')
	);

	type ConnState = 'connecting' | 'online' | 'offline';

	function peerState(persistentId: string): ConnState {
		if (presence.onlineTrysteroId(persistentId)) return 'online';
		if (!presence.isInRoom || !discoveryDone) return 'connecting';
		return 'offline';
	}

	function statusClass(state: ConnState): string {
		switch (state) {
			case 'online':
				return 'status-success';
			case 'connecting':
				return 'status-warning animate-pulse';
			case 'offline':
				return 'status-error';
		}
	}

	/** Only UI-local state tied to "which peer's tree am I looking at" — the
	 *  scan/baseline/override data below is cached per peer and deliberately
	 *  survives switching, so re-selecting a peer never re-triggers a scan. */
	function resetSyncState() {
		expandedRows = new Set();
		diffModalPath = null;
	}

	function selectPeer(id: string) {
		activePeerId = id;
		resetSyncState();
		goto(`${page.url.pathname}?peer=${id}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	function changePeer() {
		activePeerId = null;
		resetSyncState();
		goto(page.url.pathname, { replaceState: true, keepFocus: true, noScroll: true });
	}

	onMount(async () => {
		// Kick off the local scan immediately, independent of peer selection —
		// hashing every ledger file can take a moment on a large book, so
		// starting it now means it's likely already done by the time a peer
		// is chosen/connects, instead of waiting until then to begin.
		void loadLocalTree();
		await peerConnection.ensureInit();
		if (urlPeerId) activePeerId = urlPeerId;
		presenceReady = true;
	});

	/** Switches the signaling network — delegates to the shared connection. */
	async function selectStrategy(value: RelayStrategy) {
		if (presence.strategy === value) return;
		await peerConnection.setStrategy(value);
		peerSources.clear();
		// Peer set differs on the new network — force a refetch for everyone,
		// but keep each peer's baseline/overrides (unaffected by the network).
		peerStates = new Map(
			Array.from(peerStates, ([id, s]) => [
				id,
				{
					...s,
					remoteEntries: null,
					remoteLoading: false,
					remoteError: null,
					fetchedTrysteroId: null
				}
			])
		);
	}

	$effect(() => {
		if (!presence.isInRoom) {
			discoveryDone = false;
			return;
		}
		discoveryDone = false;
		// Nostr-relay discovery latency is highly variable (real-world joins have
		// taken well past a few seconds) — generous window avoids flagging a
		// still-arriving peer as offline.
		const timer = setTimeout(() => (discoveryDone = true), 15_000);
		return () => clearTimeout(timer);
	});

	// ─── File listing (local + remote) ──────────────────────────────────────────

	let localEntries = $state<SyncEntry[]>([]);
	let localLoaded = $state(false);
	let localError = $state<string | null>(null);

	async function loadLocalTree() {
		try {
			localEntries = await opfsSource.listTree();
		} catch (e) {
			localError = (e as Error).message;
		} finally {
			localLoaded = true;
		}
	}

	// ─── Per-peer sync state ─────────────────────────────────────────────────────
	// Every trusted, online peer is scanned in the background (below) — not just
	// the active one — so the peer-picker dashboard can show live pull/conflict
	// counts, and so switching which peer is active never waits on a fresh fetch.
	// Hash-based diff classification — see doc/projects/2026-07-02_beancount-peer-sync.md.

	interface PeerSyncState {
		remoteEntries: SyncEntry[] | null;
		remoteLoading: boolean;
		remoteError: string | null;
		fetchedTrysteroId: string | null;
		baseline: Map<string, PeerSyncBaseline>;
		overrides: Map<string, SyncAction>;
	}

	const EMPTY_PEER_STATE: PeerSyncState = {
		remoteEntries: null,
		remoteLoading: false,
		remoteError: null,
		fetchedTrysteroId: null,
		baseline: new Map(),
		overrides: new Map()
	};

	let peerStates = $state(new Map<string, PeerSyncState>());

	/** Immutable-style patch: clones the map and the one entry being touched, then
	 *  reassigns — Svelte tracks the `peerStates =` reassignment, not deep mutation. */
	function patchPeerState(peerId: string, patch: Partial<PeerSyncState>) {
		const next = new Map(peerStates);
		next.set(peerId, { ...(next.get(peerId) ?? EMPTY_PEER_STATE), ...patch });
		peerStates = next;
	}

	/** Not `$state` — a plain instance cache keyed by peer id. Cheap: each PeerSource
	 *  just delegates to the shared `protocol`, so this never re-registers trystero actions. */
	const peerSources = new Map<string, PeerSource>();

	function sourceFor(peerId: string): PeerSource | null {
		if (!peerConnection.protocol) return null;
		let source = peerSources.get(peerId);
		if (!source) {
			source = new PeerSource(presence, peerConnection.protocol, peerId);
			peerSources.set(peerId, source);
		}
		return source;
	}

	/** Fetches one peer's remote tree + baseline together and caches both — "on
	 *  contact" is exactly when a fresh peer-sent hash list can be compared
	 *  against the locally-stored baseline hashes from the last sync with it. */
	async function refreshPeer(peerId: string, trysteroId: string) {
		const source = sourceFor(peerId);
		if (!source) return;
		patchPeerState(peerId, {
			fetchedTrysteroId: trysteroId,
			remoteLoading: true,
			remoteError: null
		});
		try {
			const [remoteEntries, baseline] = await Promise.all([source.listTree(), getBaseline(peerId)]);
			patchPeerState(peerId, { remoteEntries, baseline, remoteLoading: false });
		} catch (e) {
			patchPeerState(peerId, {
				remoteError: (e as Error).message,
				remoteEntries: null,
				remoteLoading: false
			});
		}
	}

	$effect(() => {
		if (!peerConnection.protocol) return;
		for (const tp of onlineTrustedPeers) {
			const trysteroId = presence.onlineTrysteroId(tp.id);
			if (!trysteroId) continue;
			const state = peerStates.get(tp.id);
			if (state?.fetchedTrysteroId === trysteroId || state?.remoteLoading) continue;
			void refreshPeer(tp.id, trysteroId);
		}
	});

	/** Live pull/conflict counts for the peer-picker's status badges — reuses
	 *  whatever `refreshPeer` above already cached, without forcing a fetch. */
	function diffCountsFor(peerId: string): { pull: number; conflict: number } | null {
		if (!localLoaded) return null;
		const state = peerStates.get(peerId);
		if (!state || state.remoteEntries === null) return null;
		const diffs = diffAgainstBaseline(localEntries, state.remoteEntries, state.baseline);
		let pull = 0;
		let conflict = 0;
		for (const d of diffs) {
			const action = state.overrides.get(d.path) ?? d.action;
			if (action === 'pull') pull++;
			else if (action === 'conflict') conflict++;
		}
		return { pull, conflict };
	}

	let refreshing = $state(false);

	/**
	 * Manually re-triggers both scans for the active peer. Content hashes are
	 * already recomputed on every load, but a stale in-memory scan (e.g. the
	 * peer only just finished writing, or this device's own file changed
	 * since the page opened) needs an explicit re-scan to pick up — there's
	 * no live watcher.
	 */
	async function refreshAll() {
		if (!activePeer) return;
		refreshing = true;
		try {
			await loadLocalTree();
			const trysteroId = presence.onlineTrysteroId(activePeer.id);
			if (trysteroId) {
				await refreshPeer(activePeer.id, trysteroId);
			} else {
				patchPeerState(activePeer.id, { fetchedTrysteroId: null, remoteEntries: null });
			}
		} finally {
			refreshing = false;
		}
	}

	/** Active peer's cached scan/baseline/overrides — read-only aliases matching
	 *  the field names the rest of the page (and its template) already uses. */
	let activeState = $derived(
		activePeerId ? (peerStates.get(activePeerId) ?? EMPTY_PEER_STATE) : EMPTY_PEER_STATE
	);
	let remoteEntries = $derived(activeState.remoteEntries);
	let remoteLoading = $derived(activeState.remoteLoading);
	let remoteError = $derived(activeState.remoteError);
	let baseline = $derived(activeState.baseline);
	let overrides = $derived(activeState.overrides);
	let peerSource = $derived(activePeerId ? sourceFor(activePeerId) : null);

	/** Per-path action chosen by the user, overriding the diff's default. */
	function setAction(path: string, action: SyncAction) {
		if (!activePeerId) return;
		const next = new Map(overrides);
		next.set(path, action);
		patchPeerState(activePeerId, { overrides: next });
	}

	function pullAll(rows: { path: string }[]) {
		if (!activePeerId) return;
		const next = new Map(overrides);
		for (const r of rows) next.set(r.path, 'pull');
		patchPeerState(activePeerId, { overrides: next });
	}

	/** Sets the DOM `indeterminate` property (not reflectable as a plain attribute) on a
	 *  checkbox — used to show an unresolved conflict as neither checked nor unchecked. */
	function indeterminateAction(node: HTMLInputElement, value: boolean) {
		node.indeterminate = value;
		return {
			update(next: boolean) {
				node.indeterminate = next;
			}
		};
	}

	// Only classify once we actually have a remote scan — an offline/not-yet-loaded
	// peer must never be treated as "remote deleted everything".
	let diffByPath = $derived.by(() => {
		if (!activePeer || remoteEntries === null) return new Map<string, DiffEntry>();
		const entries = diffAgainstBaseline(localEntries, remoteEntries, baseline);
		return new Map(entries.map((e) => [e.path, e]));
	});

	/**
	 * Records local↔remote agreement for `path`: clears any pending override
	 * and updates the baseline so it drops out of future diffs. Used by the
	 * diff-preview modal's identical-content shortcut, for the rare case
	 * where a live re-read at preview time finds the two sides already match
	 * (diffAgainstBaseline already treats equal hashes as unchanged on the
	 * *next* scan; this fast-forwards the baseline without waiting for one).
	 */
	async function markSynced(path: string) {
		if (!activePeer) return;
		const localEntry = localEntries.find((e) => e.path === path);
		const remoteEntry = remoteEntries?.find((e) => e.path === path);
		if (!localEntry || !remoteEntry) return;
		await updateBaseline(activePeer.id, [{ path, local: localEntry, remote: remoteEntry }]);
		const freshBaseline = await getBaseline(activePeer.id);
		const nextOverrides = new Map(overrides);
		nextOverrides.delete(path);
		patchPeerState(activePeer.id, { baseline: freshBaseline, overrides: nextOverrides });
	}

	// ─── Apply (pull) ────────────────────────────────────────────────────────────

	let applying = $state(false);
	let applyError = $state<string | null>(null);

	async function applyChanges() {
		if (!activePeer || !peerSource) return;
		const toPull = allFileRows.filter((r) => r.effectiveAction === 'pull');
		if (toPull.length === 0) return;

		applying = true;
		applyError = null;
		const pulledRemote = new Map<string, SyncEntry>();
		const baselineRemovals: string[] = [];
		const failures: string[] = [];

		for (const row of toPull) {
			try {
				if (row.remote) {
					const content = await peerSource.readFile(row.path);
					if (content === undefined) {
						// Peer no longer has it (race since the list was fetched) — mirror the deletion.
						await opfsSource.deleteFile(row.path);
						baselineRemovals.push(row.path);
					} else {
						await opfsSource.writeFile(row.path, content);
						pulledRemote.set(row.path, row.remote);
					}
				} else {
					// Remote no longer has this file — pulling mirrors the deletion locally.
					await opfsSource.deleteFile(row.path);
					baselineRemovals.push(row.path);
				}
			} catch (e) {
				failures.push(`${row.path}: ${(e as Error).message}`);
			}
		}

		// Re-scan local so the baseline records each pulled file's actual
		// post-write hash (writeFile doesn't hand it back) — pairing that with
		// the remote entry from this pull is what lets both sides read back
		// as unchanged next time (see syncDiff.ts / PeerSyncBaseline). Remote
		// itself is untouched by a pull (v1 has no push), so no need to re-fetch it.
		const freshLocal = await opfsSource.listTree();
		const baselineUpserts: BaselineEntry[] = [];
		for (const [path, remote] of pulledRemote) {
			const local = freshLocal.find((e) => e.path === path);
			if (local) baselineUpserts.push({ path, local, remote });
		}

		if (baselineUpserts.length) await updateBaseline(activePeer.id, baselineUpserts);
		if (baselineRemovals.length) await removeBaselineEntries(activePeer.id, baselineRemovals);

		localEntries = freshLocal;
		localLoaded = true;
		const freshBaseline = await getBaseline(activePeer.id);
		patchPeerState(activePeer.id, { overrides: new Map(), baseline: freshBaseline });
		applying = false;

		if (failures.length) {
			applyError = failures.join('; ');
			Notifier.error(`${failures.length} file${failures.length === 1 ? '' : 's'} failed to sync`);
		} else {
			Notifier.success(`Synced ${toPull.length} file${toPull.length === 1 ? '' : 's'}`);
		}
	}

	// ─── Tree building — union local + remote flat paths into aligned rows ─────

	interface TreeRow {
		path: string;
		name: string;
		kind: 'file' | 'directory';
		depth: number;
		expanded: boolean;
		local?: SyncEntry;
		remote?: SyncEntry;
		status?: SyncStatus;
		/** User override if set, else the diff's default action. Undefined when no diff is available yet. */
		effectiveAction?: SyncAction;
		/** Directories only: count of conflicted files anywhere in this subtree, shown even while collapsed. */
		conflictCount?: number;
		/** Directories only: count of files anywhere in this subtree with any diff status (conflict/remote-newer/local-newer), shown even while collapsed. */
		diffCount?: number;
	}

	/** Paths the user has explicitly expanded — folders default to collapsed. */
	let expandedDirs = $state(new Set<string>());

	/** Toolbar-menu switch: hide unchanged files (and any directory left with
	 *  no differing descendant), so only the files that need a sync decision
	 *  remain — still nested under their real folder path. */
	let showDiffsOnly = $state(false);

	function toggleShowDiffsOnly() {
		showDiffsOnly = !showDiffsOnly;
	}

	function buildTree(
		localList: SyncEntry[],
		remoteList: SyncEntry[],
		expandedPaths: Set<string>,
		diffs: Map<string, DiffEntry>,
		userOverrides: Map<string, SyncAction>,
		diffsOnly: boolean
	): { rows: TreeRow[]; allFileRows: TreeRow[] } {
		const byPath = new Map<string, { local?: SyncEntry; remote?: SyncEntry }>();
		for (const e of localList) byPath.set(e.path, { ...byPath.get(e.path), local: e });
		for (const e of remoteList) byPath.set(e.path, { ...byPath.get(e.path), remote: e });

		const childrenOf = new Map<string, TreeRow[]>();
		const addChild = (parent: string, row: TreeRow) => {
			const list = childrenOf.get(parent);
			if (list) list.push(row);
			else childrenOf.set(parent, [row]);
		};

		const dirPaths = new Set<string>();
		for (const path of byPath.keys()) {
			const parts = path.split('/');
			for (let i = 1; i < parts.length; i++) dirPaths.add(parts.slice(0, i).join('/'));
		}
		const dirRowByPath = new Map<string, TreeRow>();
		for (const dirPath of dirPaths) {
			const parent = dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : '';
			const dirRow: TreeRow = {
				path: dirPath,
				name: dirPath.split('/').pop()!,
				kind: 'directory',
				depth: parent ? parent.split('/').length : 0,
				expanded: expandedPaths.has(dirPath),
				conflictCount: 0,
				diffCount: 0
			};
			dirRowByPath.set(dirPath, dirRow);
			addChild(parent, dirRow);
		}
		// Unconditional flat list of file rows — independent of expand state, so
		// apply logic always sees every file, even inside collapsed folders.
		const allFileRows: TreeRow[] = [];
		for (const [path, { local, remote }] of byPath) {
			const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
			const diff = diffs.get(path);
			const fileRow: TreeRow = {
				path,
				name: path.split('/').pop()!,
				kind: 'file',
				depth: parent ? parent.split('/').length : 0,
				expanded: false,
				local,
				remote,
				status: diff?.status,
				effectiveAction: diff ? (userOverrides.get(path) ?? diff.action) : undefined
			};
			addChild(parent, fileRow);
			allFileRows.push(fileRow);
			if (diff && diff.status !== 'unchanged') {
				const parts = path.split('/');
				for (let i = 1; i < parts.length; i++) {
					const dirRow = dirRowByPath.get(parts.slice(0, i).join('/'));
					if (dirRow) {
						dirRow.diffCount!++;
						if (diff.status === 'conflict') dirRow.conflictCount!++;
					}
				}
			}
		}
		// Visible rows only — walk stops descending into collapsed directories,
		// so this is for rendering the tree, never for bulk operations. When
		// `diffsOnly` is set, unchanged files and diff-free directories are
		// dropped, and any directory that does have a differing descendant is
		// forced open — otherwise its diffs would stay hidden behind a
		// collapsed folder the user never had a reason to expand.
		if (diffsOnly) {
			for (const dirRow of dirRowByPath.values()) {
				if (dirRow.diffCount) dirRow.expanded = true;
			}
		}
		const rows: TreeRow[] = [];
		const walk = (parent: string) => {
			const list = (childrenOf.get(parent) ?? [])
				.filter((row) =>
					!diffsOnly
						? true
						: row.kind === 'directory'
							? !!row.diffCount
							: !!row.status && row.status !== 'unchanged'
				)
				.sort((a, b) =>
					a.kind !== b.kind ? (a.kind === 'directory' ? -1 : 1) : a.name.localeCompare(b.name)
				);
			for (const row of list) {
				rows.push(row);
				if (row.kind === 'directory' && row.expanded) walk(row.path);
			}
		};
		walk('');
		return { rows, allFileRows };
	}

	let treeBuild = $derived(
		buildTree(localEntries, remoteEntries ?? [], expandedDirs, diffByPath, overrides, showDiffsOnly)
	);
	/** Visible rows, respecting collapsed folders — for rendering the tree only. */
	let treeRows = $derived(treeBuild.rows);
	/** Every file row, regardless of folder collapse state — for apply logic. */
	let allFileRows = $derived(treeBuild.allFileRows);

	// ─── Per-file diff/preview ───────────────────────────────────────────────
	// Shows what applying the row's current pull/skip selection will actually do,
	// not just a raw local-vs-remote diff — see doc/projects/2026-07-02_beancount-peer-sync.md.

	let diffModalPath = $state<string | null>(null);
	let diffModalLocalContent = $state<string | undefined>(undefined);
	let diffModalRemoteContent = $state<string | undefined>(undefined);
	let diffModalLoading = $state(false);
	let diffModalError = $state<string | null>(null);

	/** The tree row for the file currently previewed — re-derives live as the user toggles pull/skip. */
	let diffModalRow = $derived(
		diffModalPath ? (treeRows.find((r) => r.path === diffModalPath) ?? null) : null
	);

	/**
	 * Content the local file would hold *after* applying the row's current
	 * effective action — 'skip' keeps the local file as-is; 'pull' (or an
	 * unresolved conflict, previewed as if it were pulled) makes it the remote
	 * content, or deletes it if the remote no longer has the file.
	 */
	let diffModalAfterContent = $derived(
		diffModalRow?.effectiveAction === 'skip' ? diffModalLocalContent : diffModalRemoteContent
	);

	/**
	 * True once both sides of the previewed file have loaded and their raw
	 * content matches byte-for-byte — independent of the row's pull/skip
	 * selection (unlike diffModalLines, which diffs against the *post-apply*
	 * content, always trivially "equal" for a skip). Lets the modal offer the
	 * same "mark as synced" outcome as Verify without re-fetching to hash.
	 */
	let diffModalIdentical = $derived(
		diffModalLocalContent !== undefined &&
			diffModalRemoteContent !== undefined &&
			normalizeEol(diffModalLocalContent) === normalizeEol(diffModalRemoteContent)
	);

	/** Explains, in the modal, exactly what applying the row's current selection will do. */
	function previewBanner(row: TreeRow | null): { text: string; alertClass: string } | null {
		if (!row) return null;
		if (row.effectiveAction === 'pull') {
			if (!row.remote)
				return {
					text: 'Pull will delete this file locally — removed on remote.',
					alertClass: 'alert-warning'
				};
			if (!row.local)
				return { text: 'Pull will create this file locally.', alertClass: 'alert-info' };
			return {
				text: 'Pull will overwrite the local file with the remote content shown below.',
				alertClass: 'alert-info'
			};
		}
		if (row.effectiveAction === 'skip') {
			return {
				text: 'Skip selected — no changes will be applied to the local file.',
				alertClass: 'alert-success'
			};
		}
		return {
			text: 'Unresolved conflict — previewing the Pull outcome. Choose Skip above to keep the local file unchanged instead.',
			alertClass: 'alert-warning'
		};
	}

	async function openDiffFor(path: string) {
		if (!peerSource) return;
		diffModalPath = path;
		diffModalLoading = true;
		diffModalError = null;
		diffModalLocalContent = undefined;
		diffModalRemoteContent = undefined;
		try {
			const [localContent, remoteContent] = await Promise.all([
				opfsSource.readFile(path),
				peerSource.readFile(path)
			]);
			diffModalLocalContent = localContent;
			diffModalRemoteContent = remoteContent;
		} catch (e) {
			diffModalError = (e as Error).message;
		} finally {
			diffModalLoading = false;
		}
	}

	function closeDiffModal() {
		diffModalPath = null;
	}

	let markingIdentical = $state(false);

	async function markDiffModalIdentical() {
		if (!diffModalPath) return;
		markingIdentical = true;
		try {
			await markSynced(diffModalPath);
			Notifier.success(`${diffModalPath}: contents match — marked as synced.`);
			closeDiffModal();
		} finally {
			markingIdentical = false;
		}
	}

	let applyingMerge = $state(false);

	/**
	 * Writes the merged content (DiffViewer's per-hunk Theirs/Mine picks)
	 * straight to OPFS for just this file — independent of the row's
	 * pull/skip toggle in the tree below. Updates the baseline the same way
	 * a full pull does (the merge result becomes the new sync point for both
	 * sides) and clears any pending override so the row re-classifies
	 * against it, typically dropping back to unchanged.
	 */
	async function applyMergeForModal(mergedContent: string) {
		if (!activePeer || !diffModalPath) return;
		const path = diffModalPath;
		applyingMerge = true;
		try {
			await opfsSource.writeFile(path, mergedContent);
			const freshLocal = await opfsSource.listTree();
			localEntries = freshLocal;
			const local = freshLocal.find((e) => e.path === path);
			const remoteEntry = remoteEntries?.find((e) => e.path === path);
			const patch: Partial<PeerSyncState> = {};
			if (local && remoteEntry) {
				await updateBaseline(activePeer.id, [{ path, local, remote: remoteEntry }]);
				patch.baseline = await getBaseline(activePeer.id);
			}
			const nextOverrides = new Map(overrides);
			nextOverrides.delete(path);
			patch.overrides = nextOverrides;
			patchPeerState(activePeer.id, patch);
			Notifier.success(`${path}: merge applied.`);
			closeDiffModal();
		} catch (e) {
			Notifier.error(`Merge failed: ${(e as Error).message}`);
		} finally {
			applyingMerge = false;
		}
	}

	let fileRows = $derived(allFileRows);
	let conflictRows = $derived(fileRows.filter((r) => r.status === 'conflict'));
	let remoteNewerRows = $derived(fileRows.filter((r) => r.status === 'remote-newer'));
	let localNewerRows = $derived(fileRows.filter((r) => r.status === 'local-newer'));
	let unchangedRows = $derived(fileRows.filter((r) => !r.status || r.status === 'unchanged'));

	let pullCount = $derived(fileRows.filter((r) => r.effectiveAction === 'pull').length);
	let conflictCount = $derived(fileRows.filter((r) => r.effectiveAction === 'conflict').length);

	function toggleDir(path: string) {
		const next = new Set(expandedDirs);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		expandedDirs = next;
	}

	// ─── Row-expand state, used by the "Compact" view mode ─────────────────────

	let expandedRows = $state(new Set<string>());

	function toggleRowExpand(path: string) {
		const next = new Set(expandedRows);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		expandedRows = next;
	}

	// ─── View mode — three row-layout candidates (cards / compact / grouped) ──

	type ViewMode = 'cards' | 'compact' | 'grouped';
	let viewMode = $state<ViewMode>('compact');

	function formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	function formatDate(ms: number): string {
		return new Date(ms).toLocaleString();
	}

	function statusBadgeClass(status: SyncStatus): string {
		switch (status) {
			case 'local-newer':
				return 'badge-info';
			case 'remote-newer':
				return 'badge-success';
			case 'conflict':
				return 'badge-error';
			default:
				return 'badge-ghost';
		}
	}

	function statusDotClass(status: SyncStatus | undefined): string {
		switch (status) {
			case 'local-newer':
				return 'status-info';
			case 'remote-newer':
				return 'status-success';
			case 'conflict':
				return 'status-error';
			default:
				return 'status-neutral';
		}
	}

	function statusLabel(status: SyncStatus): string {
		switch (status) {
			case 'local-newer':
				return 'Local newer';
			case 'remote-newer':
				return 'Remote newer';
			case 'conflict':
				return 'Conflict';
			default:
				return 'Unchanged';
		}
	}

	function metaLine(entry: SyncEntry | undefined, sideLabel: string, missingLabel: string): string {
		if (!entry) return `${sideLabel}: ${missingLabel}`;
		return `${sideLabel}: ${formatFileSize(entry.size)} · ${formatDate(entry.lastModified)}`;
	}
</script>

{#snippet menuItems()}
	<ToolbarMenuItem
		text={showDiffsOnly ? 'Show all files' : 'Show differences only'}
		Icon={FunnelIcon}
		iconClass={showDiffsOnly ? 'text-primary' : ''}
		onclick={toggleShowDiffsOnly}
	/>
	{#each RELAY_STRATEGIES as s (s.value)}
		<ToolbarMenuItem
			text={s.label}
			Icon={presence.strategy === s.value ? Check : undefined}
			onclick={() => selectStrategy(s.value)}
		/>
	{/each}
{/snippet}

{#snippet directoryRow(row: TreeRow)}
	<button
		type="button"
		class="btn btn-ghost btn-sm w-full justify-start gap-1.5 font-mono"
		style="padding-left: {row.depth * 1.25 + 0.5}rem"
		onclick={() => toggleDir(row.path)}
	>
		{#if row.expanded}
			<FolderOpenIcon
				class="h-4 w-4 shrink-0 {row.conflictCount
					? 'text-error'
					: row.diffCount
						? 'text-warning'
						: 'opacity-60'}"
			/>
		{:else}
			<FolderIcon
				class="h-4 w-4 shrink-0 {row.conflictCount
					? 'text-error'
					: row.diffCount
						? 'text-warning'
						: 'opacity-60'}"
			/>
		{/if}
		<span class="truncate">{row.name}</span>
		{#if row.conflictCount}
			<span class="badge badge-error badge-sm ml-auto">{row.conflictCount}</span>
		{:else if row.diffCount}
			<span class="badge badge-warning badge-sm ml-auto">{row.diffCount}</span>
		{/if}
	</button>
{/snippet}

{#snippet rowActions(row: TreeRow)}
	<div class="flex flex-wrap items-center gap-2">
		{#if row.status === 'remote-newer' || row.status === 'conflict' || row.status === 'local-newer'}
			<div class="join">
				<button
					type="button"
					class="btn btn-xs join-item {row.effectiveAction === 'pull'
						? 'btn-primary'
						: 'btn-outline'}"
					onclick={() => setAction(row.path, 'pull')}
				>
					Pull
				</button>
				<button
					type="button"
					class="btn btn-xs join-item {row.effectiveAction === 'skip'
						? 'btn-neutral'
						: 'btn-outline'}"
					onclick={() => setAction(row.path, 'skip')}
				>
					Skip
				</button>
			</div>
		{/if}
		{#if row.status && row.status !== 'unchanged'}
			<button type="button" class="btn btn-xs btn-ghost" onclick={() => openDiffFor(row.path)}>
				<GitCompareArrowsIcon class="h-3.5 w-3.5" />
				Preview
			</button>
		{/if}
	</div>
{/snippet}

{#snippet pullCheckbox(row: TreeRow)}
	<input
		type="checkbox"
		class="checkbox checkbox-primary checkbox-sm shrink-0"
		checked={row.effectiveAction === 'pull'}
		use:indeterminateAction={row.effectiveAction === 'conflict'}
		aria-label={`Pull ${row.name}`}
		onchange={(e) => setAction(row.path, e.currentTarget.checked ? 'pull' : 'skip')}
	/>
{/snippet}

{#snippet previewButton(row: TreeRow)}
	{#if row.status && row.status !== 'unchanged'}
		<button type="button" class="btn btn-xs btn-ghost" onclick={() => openDiffFor(row.path)}>
			<GitCompareArrowsIcon class="h-3.5 w-3.5" />
			Preview
		</button>
	{/if}
{/snippet}

<main class="flex h-full flex-col">
	<Toolbar title="Beancount Sync" {menuItems}>
		{#snippet actions()}
			<HelpButton topic="beancount-sync" />
		{/snippet}
	</Toolbar>

	<section class="flex-1 space-y-3 overflow-y-auto touch-pan-y p-4">
		{#if !activePeer}
			<!-- Peer selection -->
			<p class="text-base-content/50 text-center text-xs">
				{localLoaded
					? `${localEntries.length} local file${localEntries.length === 1 ? '' : 's'} scanned`
					: 'Scanning local files…'}
			</p>
			{#if !presenceReady}
				<div class="flex justify-center p-8">
					<span class="loading loading-spinner"></span>
				</div>
			{:else if presence.trustedPeers.length === 0}
				<div class="rounded-box bg-base-200 space-y-3 p-4 text-center text-sm">
					<p class="opacity-70">No peers configured yet.</p>
					<a href="/peer-sync" class="btn btn-primary btn-sm">Set Up Peer Sync</a>
				</div>
			{:else if !presence.isInRoom}
				<div class="rounded-box bg-base-200 space-y-3 p-4 text-center text-sm">
					<p class="opacity-70">Not connected to the peer sync room.</p>
					<a href="/peer-sync" class="btn btn-primary btn-sm">Connect via Peer Sync</a>
				</div>
			{:else if onlineTrustedPeers.length === 0}
				<div class="rounded-box bg-base-200 space-y-2 p-4 text-center text-sm">
					<span class="loading loading-spinner loading-sm"></span>
					<p class="opacity-70">Waiting for a trusted peer to come online…</p>
				</div>
			{:else}
				<div class="rounded-box bg-base-200 p-3">
					<p class="mb-2 text-sm font-semibold opacity-70">Select a peer to sync with</p>
					<ul class="space-y-2">
						{#each onlineTrustedPeers as tp (tp.id)}
							{@const counts = diffCountsFor(tp.id)}
							<li>
								<button
									type="button"
									class="btn btn-outline btn-block justify-start gap-3"
									onclick={() => selectPeer(tp.id)}
								>
									<span class="status {statusClass(peerState(tp.id))} status-sm"></span>
									<span class="flex-1 text-left">{tp.name}</span>
									{#if counts === null}
										<span class="loading loading-spinner loading-xs opacity-50"></span>
									{:else if counts.conflict > 0 || counts.pull > 0}
										{#if counts.conflict > 0}
											<span class="badge badge-error badge-sm"
												>{counts.conflict} conflict{counts.conflict === 1 ? '' : 's'}</span
											>
										{/if}
										{#if counts.pull > 0}
											<span class="badge badge-success badge-sm">{counts.pull} to pull</span>
										{/if}
									{:else}
										<span class="badge badge-ghost badge-sm">synced</span>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		{:else}
			<!-- Peer context -->
			<div class="rounded-box bg-base-200 flex items-center gap-2 p-3 text-sm">
				<span class="status {statusClass(peerState(activePeer.id))} status-sm"></span>
				<span class="opacity-60">Syncing with:</span>
				<span class="flex-1 font-semibold">{activePeer.name}</span>
				<button
					class="btn btn-ghost btn-xs"
					disabled={refreshing}
					onclick={refreshAll}
					title="Re-scan local files and re-check the peer"
				>
					{#if refreshing}
						<span class="loading loading-spinner loading-xs"></span>
					{:else}
						<RefreshCwIcon class="h-3.5 w-3.5" />
					{/if}
					Refresh
				</button>
				<button class="btn btn-ghost btn-xs" onclick={changePeer}>Change</button>
			</div>

			<!-- View-mode switcher — TEMPORARY, for side-by-side evaluation only. -->
			<div class="join w-full">
				<button
					type="button"
					class="btn btn-xs join-item flex-1 {viewMode === 'cards'
						? 'btn-outline btn-primary'
						: ''}"
					onclick={() => (viewMode = 'cards')}>Cards</button
				>
				<button
					type="button"
					class="btn btn-xs join-item flex-1 {viewMode === 'compact'
						? 'btn-outline btn-primary'
						: ''}"
					onclick={() => (viewMode = 'compact')}>Compact</button
				>
				<button
					type="button"
					class="btn btn-xs join-item flex-1 {viewMode === 'grouped'
						? 'btn-outline btn-primary'
						: ''}"
					onclick={() => (viewMode = 'grouped')}>Grouped</button
				>
			</div>

			<!-- Summary -->
			<div class="flex flex-wrap items-center gap-2 text-sm opacity-70">
				<span>{localEntries.length} local file{localEntries.length === 1 ? '' : 's'}</span>
				{#if remoteEntries}
					<span>·</span>
					<span>{remoteEntries.length} remote file{remoteEntries.length === 1 ? '' : 's'}</span>
					{#if pullCount > 0}
						<span class="badge badge-success badge-sm ml-1">{pullCount} to pull</span>
					{/if}
					{#if conflictCount > 0}
						<span class="badge badge-error badge-sm"
							>{conflictCount} conflict{conflictCount === 1 ? '' : 's'}</span
						>
					{/if}
				{/if}
			</div>

			{#if localError}
				<div class="alert alert-error text-sm"><span>Local scan failed: {localError}</span></div>
			{/if}
			{#if remoteError}
				<div class="alert alert-warning text-sm">
					<span>Couldn't get {activePeer.name}'s file list: {remoteError}</span>
				</div>
			{:else if !presence.onlineTrysteroId(activePeer.id)}
				<div class="alert alert-warning text-sm">
					<span>{activePeer.name} is offline — showing local files only.</span>
				</div>
			{/if}

			{#if treeRows.length === 0}
				<p class="text-base-content/50 py-6 text-center text-sm">
					{localLoaded ? 'No matching files found.' : 'Scanning local files…'}
				</p>
			{:else if viewMode === 'cards'}
				<!-- Variant 1: "Cards" — one roomy card per file, everything visible at once. -->
				<ul class="flex flex-col gap-1.5">
					{#each treeRows as row (row.path)}
						{#if row.kind === 'directory'}
							<li>{@render directoryRow(row)}</li>
						{:else}
							<li class="rounded-box bg-base-200 p-3" style="margin-left: {row.depth * 1.25}rem">
								<div class="flex items-center gap-2">
									<FileIcon class="h-4 w-4 shrink-0 opacity-50" />
									<span class="font-mono text-sm truncate flex-1">{row.name}</span>
									{#if row.status && row.status !== 'unchanged'}
										<span class="badge badge-sm {statusBadgeClass(row.status)}"
											>{statusLabel(row.status)}</span
										>
									{/if}
									{#if row.status === 'remote-newer' || row.status === 'conflict' || row.status === 'local-newer'}
										{@render pullCheckbox(row)}
									{/if}
								</div>
								<div class="mt-1 flex flex-col gap-0.5 pl-6 text-xs opacity-60">
									<span>{metaLine(row.local, 'Local', '— missing')}</span>
									<span
										>{metaLine(
											row.remote,
											'Remote',
											remoteEntries ? '— missing' : '— unknown (peer offline)'
										)}</span
									>
								</div>
								{#if row.status && row.status !== 'unchanged'}
									<div class="mt-2 pl-6">{@render previewButton(row)}</div>
								{/if}
							</li>
						{/if}
					{/each}
				</ul>
			{:else if viewMode === 'compact'}
				<!-- Variant 2: "Compact" — one line per file; tap to expand metadata/actions. Best for long books. -->
				<ul class="flex flex-col divide-y divide-base-300">
					{#each treeRows as row (row.path)}
						{#if row.kind === 'directory'}
							<li>{@render directoryRow(row)}</li>
						{:else}
							{@const isOpen = expandedRows.has(row.path)}
							<li>
								<div class="flex w-full items-center gap-2 py-2">
									<button
										type="button"
										class="flex min-w-0 flex-1 items-center gap-2 text-left"
										style="padding-left: {row.depth * 1.25}rem"
										onclick={() => toggleRowExpand(row.path)}
									>
										{#if isOpen}
											<ChevronDownIcon class="h-3.5 w-3.5 shrink-0 opacity-40" />
										{:else}
											<ChevronRightIcon class="h-3.5 w-3.5 shrink-0 opacity-40" />
										{/if}
										{#if row.status}
											<span class="status {statusDotClass(row.status)} status-sm shrink-0"></span>
										{/if}
										<span class="font-mono text-sm truncate flex-1">{row.name}</span>
									</button>
									{#if row.status === 'remote-newer' || row.status === 'conflict' || row.status === 'local-newer'}
										{@render pullCheckbox(row)}
									{/if}
								</div>
								{#if isOpen}
									<div
										class="flex flex-col gap-2 pb-3 text-xs"
										style="padding-left: {row.depth * 1.25 + 1.375}rem"
									>
										{#if row.status}
											<span class="badge badge-sm {statusBadgeClass(row.status)} w-fit"
												>{statusLabel(row.status)}</span
											>
										{/if}
										<span class="opacity-60">{metaLine(row.local, 'Local', '— missing')}</span>
										<span class="opacity-60"
											>{metaLine(
												row.remote,
												'Remote',
												remoteEntries ? '— missing' : '— unknown (peer offline)'
											)}</span
										>
										{#if row.status && row.status !== 'unchanged'}
											{@render previewButton(row)}
										{/if}
									</div>
								{/if}
							</li>
						{/if}
					{/each}
				</ul>
			{:else}
				<!-- Variant 3: "Grouped" — sections by status, with bulk actions. Ignores folder nesting. -->
				<div class="flex flex-col gap-3">
					{#if conflictRows.length > 0}
						<div class="rounded-box bg-error/10 p-3">
							<div class="mb-2 flex items-center gap-2">
								<h3 class="flex-1 text-sm font-semibold">
									Conflicts <span class="badge badge-error badge-sm">{conflictRows.length}</span>
								</h3>
							</div>
							<ul class="flex flex-col gap-2">
								{#each conflictRows as row (row.path)}
									<li class="rounded-box bg-base-100 p-2.5">
										<div class="flex items-center gap-2">
											<FileIcon class="h-3.5 w-3.5 shrink-0 opacity-50" />
											<span class="font-mono text-sm truncate flex-1">{row.path}</span>
										</div>
										<div class="mt-1 flex flex-col gap-0.5 text-xs opacity-60">
											<span>{metaLine(row.local, 'Local', '— missing')}</span>
											<span>{metaLine(row.remote, 'Remote', '— missing')}</span>
										</div>
										<div class="mt-2">{@render rowActions(row)}</div>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					{#if remoteNewerRows.length > 0}
						<div class="rounded-box bg-success/10 p-3">
							<div class="mb-2 flex items-center gap-2">
								<h3 class="flex-1 text-sm font-semibold">
									Remote newer <span class="badge badge-success badge-sm"
										>{remoteNewerRows.length}</span
									>
								</h3>
								<button
									type="button"
									class="btn btn-xs btn-success"
									onclick={() => pullAll(remoteNewerRows)}
								>
									Pull all
								</button>
							</div>
							<ul class="flex flex-col gap-2">
								{#each remoteNewerRows as row (row.path)}
									<li class="rounded-box bg-base-100 p-2.5">
										<div class="flex items-center gap-2">
											<FileIcon class="h-3.5 w-3.5 shrink-0 opacity-50" />
											<span class="font-mono text-sm truncate flex-1">{row.path}</span>
										</div>
										<div class="mt-1 flex flex-col gap-0.5 text-xs opacity-60">
											<span>{metaLine(row.local, 'Local', '— missing')}</span>
											<span>{metaLine(row.remote, 'Remote', '— missing')}</span>
										</div>
										<div class="mt-2">{@render rowActions(row)}</div>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					{#if localNewerRows.length > 0}
						<div class="collapse-arrow bg-info/10 rounded-box collapse">
							<input type="checkbox" />
							<div class="collapse-title min-h-0 py-2 text-sm font-semibold">
								Local newer <span class="badge badge-info badge-sm">{localNewerRows.length}</span> — skipped
								by default; no push in v1, but you can Pull to overwrite with the remote copy
							</div>
							<div class="collapse-content">
								<ul class="flex flex-col gap-2 pt-1">
									{#each localNewerRows as row (row.path)}
										<li class="rounded-box bg-base-100 p-2.5">
											<div class="flex items-center gap-2">
												<FileIcon class="h-3.5 w-3.5 shrink-0 opacity-50" />
												<span class="font-mono text-sm truncate flex-1">{row.path}</span>
											</div>
											<div class="mt-2">{@render rowActions(row)}</div>
										</li>
									{/each}
								</ul>
							</div>
						</div>
					{/if}

					{#if unchangedRows.length > 0}
						<div class="collapse-arrow bg-base-200 rounded-box collapse">
							<input type="checkbox" />
							<div class="collapse-title min-h-0 py-2 text-sm font-semibold opacity-60">
								Unchanged <span class="badge badge-ghost badge-sm">{unchangedRows.length}</span>
							</div>
							<div class="collapse-content">
								<ul class="flex flex-col gap-1 pt-1 text-xs opacity-50">
									{#each unchangedRows as row (row.path)}
										<li class="font-mono">{row.path}</li>
									{/each}
								</ul>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	</section>

	{#if activePeer}
		<!-- Apply bar -->
		<div class="border-base-300 border-t p-4">
			{#if applyError}
				<div class="alert alert-error mb-2 text-xs"><span>{applyError}</span></div>
			{/if}
			<button
				class="btn btn-primary w-full"
				disabled={pullCount === 0 || applying}
				onclick={applyChanges}
			>
				{#if applying}
					<span class="loading loading-spinner loading-sm"></span>
				{:else}
					<DownloadIcon class="h-4 w-4" />
				{/if}
				{pullCount > 0 ? `Pull ${pullCount} file${pullCount === 1 ? '' : 's'}` : 'Nothing to pull'}
			</button>
			{#if conflictCount > 0}
				<p class="mt-2 text-center text-xs opacity-60">
					{conflictCount} conflict{conflictCount === 1 ? '' : 's'} need a decision above.
				</p>
			{/if}
		</div>
	{/if}
</main>

<!-- ─── Per-file diff/preview modal ───────────────────────────────────────── -->
{#if diffModalPath}
	<div class="modal modal-open">
		<div class="modal-box flex h-[90vh] max-w-2xl flex-col p-0">
			<div class="border-base-300 flex items-center gap-2 border-b px-4 py-3">
				<h3 class="min-w-0 flex-1 truncate font-mono font-bold text-sm">{diffModalPath}</h3>
				<button class="btn btn-ghost btn-sm" onclick={closeDiffModal}>✕</button>
			</div>
			<div class="flex-1 overflow-y-auto touch-pan-y p-4">
				{#if diffModalLoading}
					<div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
				{:else if diffModalError}
					<div class="alert alert-error text-sm"><span>{diffModalError}</span></div>
				{:else}
					<DiffViewer
						oldText={diffModalLocalContent ?? ''}
						newText={diffModalAfterContent ?? ''}
						banner={previewBanner(diffModalRow)}
						identicalMessage={diffModalRow?.effectiveAction === 'skip'
							? 'No changes will be applied.'
							: 'Files are identical.'}
						onMarkIdentical={diffModalIdentical ? markDiffModalIdentical : undefined}
						{markingIdentical}
						onApplyMerge={applyMergeForModal}
						{applyingMerge}
					/>
				{/if}
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={closeDiffModal}></button>
	</div>
{/if}
