<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import {
		FolderIcon,
		FolderOpenIcon,
		FileIcon,
		ArrowLeftIcon,
		ArrowRightIcon,
		TriangleAlertIcon,
		Check
	} from '@lucide/svelte';
	import type { RequestAction } from '@trystero-p2p/core';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import {
		PeerPresence,
		RELAY_STRATEGIES,
		type RelayStrategy
	} from '$lib/sync/peerPresence.svelte';
	import { OpfsSource } from '$lib/sync/OpfsSource';
	import type { SyncEntry } from '$lib/sync/SyncSource';
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

	function selectPeer(id: string) {
		activePeerId = id;
		goto(`${page.url.pathname}?peer=${id}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	function changePeer() {
		activePeerId = null;
		goto(page.url.pathname, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function registerListFilesAction() {
		listFilesAction = presence.makeRequestAction<null, SyncEntry[]>(
			'list-files',
			async (_request, { peerId: fromId }) => {
				if (!presence.peersMap[fromId]?.isTrusted) return [];
				return await opfsSource.listTree();
			}
		);
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
		registerListFilesAction();
	});

	/** Switches the signaling network. Reconnects a live room so the new strategy takes effect immediately. */
	async function selectStrategy(value: RelayStrategy) {
		if (presence.strategy === value) return;
		const wasInRoom = presence.isInRoom;
		if (wasInRoom) await presence.leave();
		await presence.setStrategy(value);
		if (wasInRoom) {
			await presence.join(presence.roomCode);
			registerListFilesAction();
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
	// Display-only for now: no diff classification / baseline comparison yet
	// (see doc/projects/2026-07-02_beancount-peer-sync.md, Foundation phase).

	let listFilesAction: RequestAction<null, SyncEntry[]> | null = null;

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
			remoteEntries = await listFilesAction!.request(null, {
				target: trysteroId,
				timeoutMs: 10_000
			});
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
		if (!activePeer || !listFilesAction) return;
		const trysteroId = presence.onlineTrysteroId(activePeer.id);
		if (!trysteroId) {
			fetchedTrysteroId = null;
			remoteEntries = null;
			return;
		}
		if (trysteroId !== fetchedTrysteroId) loadRemoteTree(trysteroId);
	});

	// ─── Tree building — union local + remote flat paths into aligned rows ─────

	interface TreeRow {
		path: string;
		name: string;
		kind: 'file' | 'directory';
		depth: number;
		expanded: boolean;
		local?: SyncEntry;
		remote?: SyncEntry;
	}

	let collapsedDirs = $state(new Set<string>());

	function buildTree(
		localList: SyncEntry[],
		remoteList: SyncEntry[],
		collapsed: Set<string>
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
			addChild(parent, {
				path,
				name: path.split('/').pop()!,
				kind: 'file',
				depth: parent ? parent.split('/').length : 0,
				expanded: false,
				local,
				remote
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

	let treeRows = $derived(buildTree(localEntries, remoteEntries ?? [], collapsedDirs));

	function toggleDir(path: string) {
		const next = new Set(collapsedDirs);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		collapsedDirs = next;
	}

	function formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	function formatDate(ms: number): string {
		return new Date(ms).toLocaleString();
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

<article class="flex h-screen flex-col">
	<Toolbar title="Beancount Sync" {menuItems} />

	<div
		role="alert"
		class="flex items-center gap-2 border-y-4 border-dashed border-black bg-yellow-400 px-4 py-1.5 text-sm font-semibold text-black"
	>
		<TriangleAlertIcon class="h-4 w-4 shrink-0" />
		<span>Incomplete — work in progress. Expect rough edges.</span>
	</div>

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

			<!-- Summary -->
			<div class="flex flex-wrap items-center gap-3 text-sm opacity-70">
				<span>{localEntries.length} local file{localEntries.length === 1 ? '' : 's'}</span>
				{#if remoteEntries}
					<span>·</span>
					<span>{remoteEntries.length} remote file{remoteEntries.length === 1 ? '' : 's'}</span>
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

			<!-- Tree -->
			<div class="overflow-x-auto">
				<table class="table table-sm table-zebra w-full">
					<thead>
						<tr>
							<th>Name</th>
							<th>Local</th>
							<th class="w-8"></th>
							<th>
								Remote
								{#if remoteLoading}<span class="loading loading-spinner loading-xs ml-1"
									></span>{/if}
							</th>
						</tr>
					</thead>
					<tbody>
						{#if treeRows.length === 0}
							<tr>
								<td colspan="4" class="text-base-content/50 py-6 text-center text-sm">
									{localLoaded ? 'No matching files found.' : 'Scanning local files…'}
								</td>
							</tr>
						{/if}
						{#each treeRows as row (row.path)}
							<tr
								class="hover {row.kind === 'directory' ? 'cursor-pointer' : ''}"
								onclick={() => row.kind === 'directory' && toggleDir(row.path)}
							>
								<td class="font-mono text-sm">
									<span class="flex items-center gap-1" style="padding-left: {row.depth * 1.25}rem">
										{#if row.kind === 'directory'}
											{#if row.expanded}
												<FolderOpenIcon class="w-4 h-4 opacity-60 shrink-0" />
											{:else}
												<FolderIcon class="w-4 h-4 opacity-60 shrink-0" />
											{/if}
										{:else}
											<FileIcon class="w-4 h-4 opacity-60 shrink-0" />
										{/if}
										{row.name}
									</span>
								</td>
								<td class="text-xs">
									{#if row.local}
										<div>{formatFileSize(row.local.size)}</div>
										<div class="opacity-50">{formatDate(row.local.lastModified)}</div>
									{:else if row.kind === 'file'}
										<span class="opacity-30">—</span>
									{/if}
								</td>
								<td class="text-center">
									{#if row.kind === 'file'}
										{#if row.local && row.remote}
											<span class="opacity-30">·</span>
										{:else if row.local}
											<ArrowLeftIcon class="mx-auto h-3.5 w-3.5 opacity-50" />
										{:else if row.remote}
											<ArrowRightIcon class="mx-auto h-3.5 w-3.5 opacity-50" />
										{/if}
									{/if}
								</td>
								<td class="text-xs">
									{#if row.remote}
										<div>{formatFileSize(row.remote.size)}</div>
										<div class="opacity-50">{formatDate(row.remote.lastModified)}</div>
									{:else if row.kind === 'file'}
										<span class="opacity-30">—</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	{#if activePeer}
		<!-- Apply bar -->
		<div class="border-base-300 border-t p-4">
			<button class="btn btn-primary w-full" disabled title="Sync engine not yet implemented"
				>Apply</button
			>
		</div>
	{/if}
</article>
