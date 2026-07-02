<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import {
		FolderIcon,
		FolderOpenIcon,
		FileIcon,
		TriangleAlertIcon,
		Check,
		DownloadIcon,
		ShieldCheckIcon,
		GitCompareArrowsIcon,
		ChevronUpIcon,
		ChevronDownIcon,
		ChevronRightIcon
	} from '@lucide/svelte';
	import { PeerSource } from '$lib/sync/PeerSource';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import Notifier from '$lib/utils/notifier';
	import {
		PeerPresence,
		RELAY_STRATEGIES,
		type RelayStrategy
	} from '$lib/sync/peerPresence.svelte';
	import { OpfsSource } from '$lib/sync/OpfsSource';
	import type { SyncEntry } from '$lib/sync/SyncSource';
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
	import { buildDiffLines } from '$lib/utils/diffText';
	import type { PeerSyncBaseline } from '$lib/data/model';

	// ─── Peer selection & connection state ──────────────────────────────────────

	const presence = new PeerPresence();
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

	function resetSyncState() {
		overrides = new Map();
		verifying = new Set();
		expandedRows = new Set();
		baseline = new Map();
		localEntries = [];
		localLoaded = false;
		remoteEntries = null;
		fetchedTrysteroId = null;
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

	function makePeerSource(): PeerSource {
		return new PeerSource(presence, opfsSource, () => activePeerId);
	}

	onMount(async () => {
		await presence.init();
		if (urlPeerId) activePeerId = urlPeerId;
		presenceReady = true;
		// Join unconditionally (mirrors peer-sync) — even with zero trusted peers
		// recorded locally, joining lets a peer who *does* trust us discover this
		// device. Gating this on `trustedPeers.length > 0` broke discovery whenever
		// trust wasn't yet fully mutual.
		await presence.join(presence.roomCode);
		peerSource = makePeerSource();
	});

	/** Switches the signaling network. Reconnects a live room so the new strategy takes effect immediately. */
	async function selectStrategy(value: RelayStrategy) {
		if (presence.strategy === value) return;
		const wasInRoom = presence.isInRoom;
		if (wasInRoom) await presence.leave();
		await presence.setStrategy(value);
		if (wasInRoom) {
			await presence.join(presence.roomCode);
			peerSource = makePeerSource();
		}
		// Peer set differs on the new network — force a refetch.
		fetchedTrysteroId = null;
		remoteEntries = null;
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

	onDestroy(() => presence.leave());

	// ─── File listing (local + remote) ──────────────────────────────────────────

	let peerSource: PeerSource | null = null;

	let localEntries = $state<SyncEntry[]>([]);
	let localLoaded = $state(false);
	let localError = $state<string | null>(null);

	let remoteEntries = $state<SyncEntry[] | null>(null);
	let remoteLoading = $state(false);
	let remoteError = $state<string | null>(null);
	let fetchedTrysteroId: string | null = null;

	async function loadLocalTree() {
		try {
			localEntries = await opfsSource.listTree();
		} catch (e) {
			localError = (e as Error).message;
		} finally {
			localLoaded = true;
		}
	}

	async function loadRemoteTree(trysteroId: string) {
		fetchedTrysteroId = trysteroId;
		remoteLoading = true;
		remoteError = null;
		try {
			remoteEntries = await peerSource!.listTree();
		} catch (e) {
			remoteError = (e as Error).message;
			remoteEntries = null;
		} finally {
			remoteLoading = false;
		}
	}

	$effect(() => {
		if (activePeer && !localLoaded) loadLocalTree();
	});

	$effect(() => {
		if (!activePeer || !peerSource) return;
		const trysteroId = presence.onlineTrysteroId(activePeer.id);
		if (!trysteroId) {
			fetchedTrysteroId = null;
			remoteEntries = null;
			return;
		}
		if (trysteroId !== fetchedTrysteroId) loadRemoteTree(trysteroId);
	});

	// ─── Diff classification against the last-synced baseline ─────────────────
	// Metadata-only (never hashes automatically) — see doc/projects/2026-07-02_beancount-peer-sync.md.

	let baseline = $state(new Map<string, PeerSyncBaseline>());

	$effect(() => {
		if (!activePeer) {
			baseline = new Map();
			return;
		}
		getBaseline(activePeer.id).then((b) => (baseline = b));
	});

	/** Per-path action chosen by the user, overriding the diff's default. Reset whenever the peer or file set changes. */
	let overrides = $state(new Map<string, SyncAction>());

	function setAction(path: string, action: SyncAction) {
		const next = new Map(overrides);
		next.set(path, action);
		overrides = next;
	}

	function pullAll(rows: { path: string }[]) {
		const next = new Map(overrides);
		for (const r of rows) next.set(r.path, 'pull');
		overrides = next;
	}

	// Only classify once we actually have a remote scan — an offline/not-yet-loaded
	// peer must never be treated as "remote deleted everything".
	let diffByPath = $derived.by(() => {
		if (!activePeer || remoteEntries === null) return new Map<string, DiffEntry>();
		const entries = diffAgainstBaseline(localEntries, remoteEntries, baseline);
		return new Map(entries.map((e) => [e.path, e]));
	});

	// ─── Verify (hash-confirm) a conflict row without pulling content ──────────

	let verifying = $state(new Set<string>());

	/** Records local↔remote agreement for `path`: clears any pending override and updates the baseline so it drops out of future diffs. Shared by the hash-based Verify action and the preview modal's identical-content shortcut (which already has both sides' text in memory and has no need to re-hash). */
	async function markSynced(path: string) {
		if (!activePeer) return;
		const localEntry = localEntries.find((e) => e.path === path);
		const remoteEntry = remoteEntries?.find((e) => e.path === path);
		if (!localEntry || !remoteEntry) return;
		await updateBaseline(activePeer.id, [{ path, local: localEntry, remote: remoteEntry }]);
		baseline = await getBaseline(activePeer.id);
		const next = new Map(overrides);
		next.delete(path);
		overrides = next;
	}

	async function verifyRow(path: string) {
		if (!activePeer || !peerSource) return;
		verifying = new Set(verifying).add(path);
		try {
			const [localHash, remoteHash] = await Promise.all([
				opfsSource.hashFile(path),
				peerSource.hashFile(path)
			]);
			if (localHash !== undefined && localHash === remoteHash) {
				await markSynced(path);
				Notifier.success(`${path}: contents match — marked as synced.`);
			} else {
				Notifier.warning(`${path}: contents differ — no changes made.`);
			}
		} catch (e) {
			Notifier.error(`Verify failed: ${(e as Error).message}`);
		} finally {
			const next = new Set(verifying);
			next.delete(path);
			verifying = next;
		}
	}

	/** Hash-verifies every row in the given set in one batch (conflict or local-newer rows). */
	async function verifyRows(rows: { path: string }[]) {
		if (!activePeer || rows.length === 0) return;
		await Promise.all(rows.map((r) => verifyRow(r.path)));
		baseline = await getBaseline(activePeer.id);
	}

	// ─── Apply (pull) ────────────────────────────────────────────────────────────

	let applying = $state(false);
	let applyError = $state<string | null>(null);

	async function applyChanges() {
		if (!activePeer || !peerSource) return;
		const toPull = treeRows.filter((r) => r.kind === 'file' && r.effectiveAction === 'pull');
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

		// Re-scan local so the baseline records each written file's *actual*
		// post-write metadata — OPFS always assigns a fresh "now" mtime on
		// write, never the remote's original one, so pairing that with the
		// remote entry from this pull is what lets both sides read back as
		// unchanged next time (see syncDiff.ts / PeerSyncBaseline).
		const freshLocal = await opfsSource.listTree();
		const baselineUpserts: BaselineEntry[] = [];
		for (const [path, remote] of pulledRemote) {
			const local = freshLocal.find((e) => e.path === path);
			if (local) baselineUpserts.push({ path, local, remote });
		}

		if (baselineUpserts.length) await updateBaseline(activePeer.id, baselineUpserts);
		if (baselineRemovals.length) await removeBaselineEntries(activePeer.id, baselineRemovals);

		overrides = new Map();
		localEntries = freshLocal;
		localLoaded = true;
		fetchedTrysteroId = null; // re-triggers the remote-scan effect
		baseline = await getBaseline(activePeer.id);
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
	}

	let collapsedDirs = $state(new Set<string>());

	function buildTree(
		localList: SyncEntry[],
		remoteList: SyncEntry[],
		collapsed: Set<string>,
		diffs: Map<string, DiffEntry>,
		userOverrides: Map<string, SyncAction>
	): TreeRow[] {
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
		for (const dirPath of dirPaths) {
			const parent = dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : '';
			addChild(parent, {
				path: dirPath,
				name: dirPath.split('/').pop()!,
				kind: 'directory',
				depth: parent ? parent.split('/').length : 0,
				expanded: !collapsed.has(dirPath)
			});
		}
		for (const [path, { local, remote }] of byPath) {
			const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
			const diff = diffs.get(path);
			addChild(parent, {
				path,
				name: path.split('/').pop()!,
				kind: 'file',
				depth: parent ? parent.split('/').length : 0,
				expanded: false,
				local,
				remote,
				status: diff?.status,
				effectiveAction: diff ? (userOverrides.get(path) ?? diff.action) : undefined
			});
		}

		const rows: TreeRow[] = [];
		const walk = (parent: string) => {
			const list = (childrenOf.get(parent) ?? []).sort((a, b) =>
				a.kind !== b.kind ? (a.kind === 'directory' ? -1 : 1) : a.name.localeCompare(b.name)
			);
			for (const row of list) {
				rows.push(row);
				if (row.kind === 'directory' && row.expanded) walk(row.path);
			}
		};
		walk('');
		return rows;
	}

	let treeRows = $derived(
		buildTree(localEntries, remoteEntries ?? [], collapsedDirs, diffByPath, overrides)
	);

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

	let diffModalLines = $derived(
		buildDiffLines(diffModalLocalContent ?? '', diffModalAfterContent ?? '')
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
			diffModalLocalContent === diffModalRemoteContent
	);

	/** Start index (into diffModalLines) of each contiguous run of added/removed lines. */
	let diffHunks = $derived.by(() => {
		const starts: number[] = [];
		let inHunk = false;
		diffModalLines.forEach((line, i) => {
			if (line.type === 'context') {
				inHunk = false;
			} else if (!inHunk) {
				starts.push(i);
				inHunk = true;
			}
		});
		return starts;
	});

	/** Index into diffHunks of the hunk last scrolled to; -1 = none visited yet. */
	let currentHunk = $state(-1);

	function scrollToHunk(index: number) {
		const lineIndex = diffHunks[index];
		if (lineIndex === undefined) return;
		document
			.getElementById(`diff-line-${lineIndex}`)
			?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	function prevHunk() {
		if (currentHunk <= 0) return;
		currentHunk -= 1;
		scrollToHunk(currentHunk);
	}

	function nextHunk() {
		if (currentHunk >= diffHunks.length - 1) return;
		currentHunk += 1;
		scrollToHunk(currentHunk);
	}

	// The set of hunks changes whenever the previewed file or its selected
	// action changes (diffModalLines is recomputed) — restart navigation.
	$effect(() => {
		void diffModalLines;
		currentHunk = -1;
	});

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

	let fileRows = $derived(treeRows.filter((r) => r.kind === 'file'));
	let conflictRows = $derived(fileRows.filter((r) => r.status === 'conflict'));
	let remoteNewerRows = $derived(fileRows.filter((r) => r.status === 'remote-newer'));
	let localNewerRows = $derived(fileRows.filter((r) => r.status === 'local-newer'));
	let unchangedRows = $derived(fileRows.filter((r) => !r.status || r.status === 'unchanged'));
	/** Rows with a remote counterpart to hash-compare against (pure local-only or pure remote-only files have nothing to verify). */
	let verifiableLocalNewerRows = $derived(localNewerRows.filter((r) => r.remote));
	let verifiableRemoteNewerRows = $derived(remoteNewerRows.filter((r) => r.remote));
	/** Non-conflict rows whose differing metadata might still hide identical content — the "Newer" verify scope. */
	let diffRows = $derived([...verifiableRemoteNewerRows, ...verifiableLocalNewerRows]);
	/** Every row a bulk verify could act on, across all three scopes. */
	let allVerifiableRows = $derived([...conflictRows, ...diffRows]);

	let pullCount = $derived(fileRows.filter((r) => r.effectiveAction === 'pull').length);
	let conflictCount = $derived(fileRows.filter((r) => r.effectiveAction === 'conflict').length);

	/**
	 * Scope for the top-level bulk "Verify" bar. Conflicts default because
	 * they're usually few and each blocks a pull/skip decision — verifying
	 * can resolve the decision outright. "Newer"/"All" scale with total
	 * changed files: cheap to hash on a LAN, wasteful to hash over the
	 * internet on a large book, so they're opt-in rather than default.
	 */
	let verifyScope = $state<'conflicts' | 'diffs' | 'all'>('conflicts');
	let verifyTargetRows = $derived(
		verifyScope === 'conflicts'
			? conflictRows
			: verifyScope === 'diffs'
				? diffRows
				: allVerifiableRows
	);

	function toggleDir(path: string) {
		const next = new Set(collapsedDirs);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		collapsedDirs = next;
	}

	// ─── Row-expand state, used by the "Compact" view mode ─────────────────────

	let expandedRows = $state(new Set<string>());

	function toggleRowExpand(path: string) {
		const next = new Set(expandedRows);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		expandedRows = next;
	}

	// ─── View mode — three row-layout candidates, switchable for side-by-side
	// evaluation. Pick a winner and delete the other two + this switcher.

	type ViewMode = 'cards' | 'compact' | 'grouped';
	let viewMode = $state<ViewMode>('cards');

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
			<FolderOpenIcon class="h-4 w-4 shrink-0 opacity-60" />
		{:else}
			<FolderIcon class="h-4 w-4 shrink-0 opacity-60" />
		{/if}
		{row.name}
	</button>
{/snippet}

{#snippet rowActions(row: TreeRow)}
	<div class="flex flex-wrap items-center gap-2">
		{#if row.status === 'remote-newer' || row.status === 'conflict'}
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
		{:else if row.status === 'local-newer'}
			<span class="badge badge-ghost badge-sm">Skipped — local is ahead</span>
		{/if}
		{#if row.status === 'conflict' || row.status === 'remote-newer' || (row.status === 'local-newer' && row.remote)}
			<button
				type="button"
				class="btn btn-xs btn-outline"
				disabled={verifying.has(row.path)}
				onclick={() => verifyRow(row.path)}
			>
				{#if verifying.has(row.path)}
					<span class="loading loading-spinner loading-xs"></span>
				{:else}
					<ShieldCheckIcon class="h-3.5 w-3.5" />
				{/if}
				Verify
			</button>
		{/if}
		{#if row.status && row.status !== 'unchanged'}
			<button type="button" class="btn btn-xs btn-ghost" onclick={() => openDiffFor(row.path)}>
				<GitCompareArrowsIcon class="h-3.5 w-3.5" />
				Preview
			</button>
		{/if}
	</div>
{/snippet}

<article class="flex h-screen flex-col">
	<Toolbar title="Beancount Sync" {menuItems}>
		{#snippet actions()}
			<HelpButton topic="beancount-sync" />
		{/snippet}
	</Toolbar>

	<section class="flex-1 space-y-3 overflow-y-auto p-4">
		{#if !activePeer}
			<!-- Peer selection -->
			{#if !presenceReady}
				<div class="flex justify-center p-8">
					<span class="loading loading-spinner"></span>
				</div>
			{:else if presence.trustedPeers.length === 0}
				<div class="rounded-box bg-base-200 space-y-3 p-4 text-center text-sm">
					<p class="opacity-70">No peers configured yet.</p>
					<a href="/peer-sync" class="btn btn-primary btn-sm">Set Up Peer Sync</a>
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
							<li>
								<button
									type="button"
									class="btn btn-outline btn-block justify-start gap-3"
									onclick={() => selectPeer(tp.id)}
								>
									<span class="status {statusClass(peerState(tp.id))} status-sm"></span>
									<span class="flex-1 text-left">{tp.name}</span>
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
				<button class="btn btn-ghost btn-xs" onclick={changePeer}>Change</button>
			</div>

			<!-- Bulk verify — always visible; pick a scope, then hash-confirm every row in it in one go. -->
			{#if remoteEntries && allVerifiableRows.length > 0}
				<div class="rounded-box bg-base-200 flex flex-wrap items-center gap-2 p-2.5 text-sm">
					<ShieldCheckIcon class="h-4 w-4 shrink-0 opacity-60" />
					<div class="join">
						<button
							type="button"
							class="btn btn-xs join-item {verifyScope === 'conflicts' ? 'btn-active' : ''}"
							disabled={conflictRows.length === 0}
							onclick={() => (verifyScope = 'conflicts')}
						>
							Conflicts ({conflictRows.length})
						</button>
						<button
							type="button"
							class="btn btn-xs join-item {verifyScope === 'diffs' ? 'btn-active' : ''}"
							disabled={diffRows.length === 0}
							onclick={() => (verifyScope = 'diffs')}
						>
							Newer ({diffRows.length})
						</button>
						<button
							type="button"
							class="btn btn-xs join-item {verifyScope === 'all' ? 'btn-active' : ''}"
							onclick={() => (verifyScope = 'all')}
						>
							All ({allVerifiableRows.length})
						</button>
					</div>
					<button
						type="button"
						class="btn btn-xs btn-outline ml-auto"
						disabled={verifyTargetRows.length === 0 ||
							verifyTargetRows.some((r) => verifying.has(r.path))}
						onclick={() => verifyRows(verifyTargetRows)}
					>
						{#if verifyTargetRows.some((r) => verifying.has(r.path))}
							<span class="loading loading-spinner loading-xs"></span>
						{:else}
							<ShieldCheckIcon class="h-3.5 w-3.5" />
						{/if}
						Verify {verifyTargetRows.length}
					</button>
				</div>
			{/if}

			<!-- View-mode switcher — TEMPORARY, for side-by-side evaluation only. -->
			<div class="join w-full">
				<button
					type="button"
					class="btn btn-xs join-item flex-1 {viewMode === 'cards' ? 'btn-active' : ''}"
					onclick={() => (viewMode = 'cards')}>Cards</button
				>
				<button
					type="button"
					class="btn btn-xs join-item flex-1 {viewMode === 'compact' ? 'btn-active' : ''}"
					onclick={() => (viewMode = 'compact')}>Compact</button
				>
				<button
					type="button"
					class="btn btn-xs join-item flex-1 {viewMode === 'grouped' ? 'btn-active' : ''}"
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
									<div class="mt-2 pl-6">{@render rowActions(row)}</div>
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
								<button
									type="button"
									class="flex w-full items-center gap-2 py-2 text-left"
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
									{#if row.effectiveAction === 'pull'}
										<DownloadIcon class="h-3.5 w-3.5 shrink-0 opacity-50" />
									{/if}
								</button>
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
											{@render rowActions(row)}
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
								Local newer <span class="badge badge-info badge-sm">{localNewerRows.length}</span> — no
								push in v1, always skipped
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
</article>

<!-- ─── Per-file diff/preview modal ───────────────────────────────────────── -->
{#if diffModalPath}
	<div class="modal modal-open">
		<div class="modal-box flex h-[90vh] max-w-2xl flex-col p-0">
			<div class="border-base-300 flex items-center gap-2 border-b px-4 py-3">
				<h3 class="min-w-0 flex-1 truncate font-mono font-bold text-sm">{diffModalPath}</h3>
				{#if diffHunks.length > 0}
					<span class="shrink-0 text-xs opacity-50">{currentHunk + 1}/{diffHunks.length}</span>
					<button
						type="button"
						class="btn btn-ghost btn-xs btn-square"
						disabled={currentHunk <= 0}
						aria-label="Previous change"
						onclick={prevHunk}
					>
						<ChevronUpIcon class="h-4 w-4" />
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-xs btn-square"
						disabled={currentHunk >= diffHunks.length - 1}
						aria-label="Next change"
						onclick={nextHunk}
					>
						<ChevronDownIcon class="h-4 w-4" />
					</button>
				{/if}
				<button class="btn btn-ghost btn-sm" onclick={closeDiffModal}>✕</button>
			</div>
			<div class="flex-1 overflow-y-auto p-4">
				{#if diffModalLoading}
					<div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
				{:else if diffModalError}
					<div class="alert alert-error text-sm"><span>{diffModalError}</span></div>
				{:else}
					{@const banner = previewBanner(diffModalRow)}
					{#if banner}
						<div class="alert {banner.alertClass} mb-3 text-xs">
							<span>{banner.text}</span>
						</div>
					{/if}
					{#if diffModalLines.every((l) => l.type === 'context')}
						<p class="text-success text-sm">
							{diffModalRow?.effectiveAction === 'skip'
								? 'No changes will be applied.'
								: 'Files are identical.'}
						</p>
						{#if diffModalIdentical}
							<button
								type="button"
								class="btn btn-success btn-xs mt-2"
								disabled={markingIdentical}
								onclick={markDiffModalIdentical}
							>
								{#if markingIdentical}
									<span class="loading loading-spinner loading-xs"></span>
								{:else}
									<ShieldCheckIcon class="h-3.5 w-3.5" />
								{/if}
								Mark as identical
							</button>
						{/if}
					{:else}
						<div class="flex gap-4 pb-2 text-xs opacity-50">
							<span class="flex items-center gap-1.5"
								><span class="bg-success/40 inline-block h-3 w-3 rounded-sm"></span>added</span
							>
							<span class="flex items-center gap-1.5"
								><span class="bg-error/40 inline-block h-3 w-3 rounded-sm"></span>removed</span
							>
						</div>
						<div class="rounded bg-base-200 p-2 font-mono text-xs leading-5">
							{#each diffModalLines as line, i}
								<div id="diff-line-{i}">
									{#if line.type === 'removed'}
										<div class="bg-error/20 text-error-content break-all whitespace-pre-wrap">
											- {line.content}
										</div>
									{:else if line.type === 'added'}
										<div class="bg-success/20 text-success-content break-all whitespace-pre-wrap">
											+ {line.content}
										</div>
									{:else}
										<div class="break-all whitespace-pre-wrap opacity-50">
											&nbsp; {line.content}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={closeDiffModal}></button>
	</div>
{/if}
