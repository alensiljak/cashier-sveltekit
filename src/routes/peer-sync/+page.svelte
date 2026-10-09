<script lang="ts">
	import { onMount } from 'svelte';
	import JsonMergeViewer from '#lib/components/JsonMergeViewer.svelte';
	import db from '#lib/data/db';
	import { summarizeScxReport, type ScxMergeReport } from '#lib/services/scxMergeReport';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import { Setting } from '#lib/data/model';
	import Notifier from '#lib/utils/notifier';
	import {
		GitCompareArrowsIcon,
		DownloadIcon,
		RefreshCwIcon,
		Circle,
		CircleCheck,
		FolderSyncIcon,
		ChevronRightIcon,
		PlugZap,
		Unplug,
		SettingsIcon
	} from '@lucide/svelte';
	import { reloadLedgerFromOpfs } from '#lib/services/ledgerReload';
	import { OpfsSource } from '#lib/sync/OpfsSource';
	import { PeerSource } from '#lib/sync/PeerSource';
	import { diffAgainstBaseline, type DiffEntry } from '#lib/sync/syncDiff';
	import { getBaseline } from '#lib/sync/syncBaseline';
	import { pullFiles } from '#lib/sync/pullFiles';
	import type { ActivePeer } from '#lib/sync/peerPresence.svelte';
	import {
		peerConnection,
		getLocalData,
		getLocalHashes,
		type RemoteData
	} from '#lib/sync/peerConnection.svelte';

	// ─── Types ───────────────────────────────────────────────────────────────────
	/**
	 * Settings are JSON — a raw text-hunk splice on JSON risks producing invalid
	 * output wherever a hunk boundary falls inside the structure (trailing commas,
	 * unbalanced braces), so they go through JsonMergeViewer's keyed (per-entry)
	 * merge instead. See keyedMerge.ts. (Scheduled transactions are a CRDT and
	 * merge automatically, so they have no diff.)
	 */
	type RawDiffSection = {
		filename: 'settings.json';
		kind: 'settings';
		local: Setting[];
		remote: Setting[];
	};

	// ─── Presence (identity, room, peers, trust) ───────────────────────────────
	// Shared singleton (see peerConnection.svelte.ts) — the room stays joined
	// across navigation; only the Connect toggle below or leaving the app
	// disconnects it.
	const presence = peerConnection.presence;
	let connecting = $state(false);

	// ─── Sync UI ─────────────────────────────────────────────────────────────────

	let syncTargetId = $state<string | null>(null); // trysteroId of selected peer
	let syncTarget = $derived(syncTargetId ? presence.peersMap[syncTargetId] : null);

	// Selected peer disappeared from the room — drop the stale selection.
	$effect(() => {
		if (syncTargetId && !presence.peersMap[syncTargetId]) syncTargetId = null;
	});

	// Trust removed (e.g. on the Setup page) while selected — drop the selection.
	$effect(() => {
		if (syncTarget && !syncTarget.isTrusted) syncTargetId = null;
	});

	// Sole trusted peer in the room and nothing chosen yet — pick it automatically.
	let trustedActivePeers = $derived(presence.activePeerList.filter((p) => p.isTrusted));
	$effect(() => {
		if (!syncTargetId && trustedActivePeers.length === 1) {
			syncTargetId = trustedActivePeers[0].trysteroId;
		}
	});

	// ─── Item hash status (same/different vs peer) ────────────────────────────
	// Exchanged eagerly as soon as a peer is selected — cheap SHA-256 digests
	// only (peerConnection.ts's `sync-hash` protocol), never full content — so
	// the panel shows which items actually differ before Preview/Diff/Pull
	// pulls anything across the wire. Mirrors how /sync/beancount hashes its
	// tree scan immediately rather than waiting for an explicit action.
	type HashStatus = 'checking' | 'same' | 'different' | 'error';
	type SyncItem = 'settings';
	const ALL_ITEMS = ['settings'];
	let hashStatus = $state<Record<SyncItem, HashStatus | null>>({
		settings: null
	});

	$effect(() => {
		const targetId = syncTargetId;
		if (!targetId) {
			hashStatus = { settings: null };
			ydocStatus = null;
			scxStatus = null;
			return;
		}
		checkHashes(targetId);
	});

	function itemHashStatus(local: string | null, remote: string | null): HashStatus {
		if (local === null || remote === null) return 'error';
		return local === remote ? 'same' : 'different';
	}

	async function checkHashes(targetId: string) {
		hashStatus = { settings: 'checking' };
		void checkYdocHash(targetId);
		void checkScxHash(targetId);
		void checkFiles(targetId);
		try {
			const [local, remote] = await Promise.all([
				getLocalHashes(ALL_ITEMS),
				peerConnection.fetchRemoteHashes(targetId, ALL_ITEMS)
			]);
			if (targetId !== syncTargetId) return; // stale — user switched peers meanwhile
			hashStatus = {
				settings: itemHashStatus(local.settings, remote.settings)
			};
		} catch {
			if (targetId !== syncTargetId) return;
			hashStatus = { settings: 'error' };
		}
	}

	// ─── Local Transactions (CRDT store) ──────────────────────────────────────
	// Merged automatically (no diff view), so it's a status plus one Sync action.
	let ydocStatus = $state<HashStatus | null>(null);
	let syncingYdoc = $state(false);

	async function checkYdocHash(targetId: string) {
		ydocStatus = 'checking';
		try {
			const local = await peerConnection.getLocalYdocHash();
			const remote = await peerConnection.fetchRemoteYdocHash(targetId);
			if (targetId !== syncTargetId) return;
			ydocStatus = itemHashStatus(local, remote);
		} catch {
			if (targetId !== syncTargetId) return;
			ydocStatus = 'error';
		}
	}

	async function syncLocalTransactions() {
		if (!syncTargetId || syncingYdoc) return;
		const targetId = syncTargetId;
		syncingYdoc = true;
		try {
			const changed = await peerConnection.syncYdoc(targetId);
			if (changed) await reloadLedgerFromOpfs();
			Notifier.success(changed ? 'Local Transactions merged' : 'Local Transactions already in sync');
			await checkYdocHash(targetId);
		} catch (e) {
			Notifier.error('Sync failed: ' + (e as Error).message);
		} finally {
			syncingYdoc = false;
		}
	}

	// ─── Scheduled Transactions (CRDT store) ──────────────────────────────────
	// Merged like Local Transactions; the result is reported once, not kept.
	let scxStatus = $state<HashStatus | null>(null);
	let syncingScx = $state(false);
	let scxReport = $state<ScxMergeReport | null>(null);

	async function checkScxHash(targetId: string) {
		scxStatus = 'checking';
		try {
			const local = await peerConnection.getLocalScxHash();
			const remote = await peerConnection.fetchRemoteScxHash(targetId);
			if (targetId !== syncTargetId) return;
			scxStatus = itemHashStatus(local, remote);
		} catch {
			if (targetId !== syncTargetId) return;
			scxStatus = 'error';
		}
	}

	async function syncScheduledTransactions() {
		if (!syncTargetId || syncingScx) return;
		const targetId = syncTargetId;
		syncingScx = true;
		try {
			const { changed, report } = await peerConnection.syncScx(targetId);
			if (changed) scxReport = report;
			Notifier.success(
				changed
					? `Scheduled Transactions merged: ${summarizeScxReport(report)}`
					: 'Scheduled Transactions already in sync'
			);
			await checkScxHash(targetId);
		} catch (e) {
			Notifier.error('Sync failed: ' + (e as Error).message);
		} finally {
			syncingScx = false;
		}
	}

	// ─── Journal files (OPFS tree) ────────────────────────────────────────────
	// Same hash-based scan as /sync/beancount, summarised: how many files a pull
	// would take (remote-newer) and how many conflict. "Pull" here only takes the
	// unambiguous remote-newer files; conflicts are resolved on the detail page.
	const opfsSource = new OpfsSource();
	type FilesState = {
		status: 'checking' | 'ready' | 'error';
		diffs: DiffEntry[];
	};
	let filesState = $state<FilesState | null>(null);
	let pullingFiles = $state(false);
	let filesPullable = $derived(filesState?.diffs.filter((d) => d.status === 'remote-newer') ?? []);
	let filesConflicts = $derived(filesState?.diffs.filter((d) => d.status === 'conflict') ?? []);

	function peerSourceFor(persistentId: string): PeerSource | null {
		return peerConnection.protocol
			? new PeerSource(presence, peerConnection.protocol, persistentId)
			: null;
	}

	async function checkFiles(targetId: string) {
		const persistentId = presence.peersMap[targetId]?.persistentId;
		const source = persistentId ? peerSourceFor(persistentId) : null;
		if (!persistentId || !source) {
			filesState = { status: 'error', diffs: [] };
			return;
		}
		filesState = { status: 'checking', diffs: [] };
		try {
			const [local, remote, baseline] = await Promise.all([
				opfsSource.listTree(),
				source.listTree(),
				getBaseline(persistentId)
			]);
			if (targetId !== syncTargetId) return;
			filesState = { status: 'ready', diffs: diffAgainstBaseline(local, remote, baseline) };
		} catch {
			if (targetId !== syncTargetId) return;
			filesState = { status: 'error', diffs: [] };
		}
	}

	async function pullNewerFiles() {
		if (!syncTargetId || !syncTarget || pullingFiles || filesPullable.length === 0) return;
		const targetId = syncTargetId;
		const source = peerSourceFor(syncTarget.persistentId);
		if (!source) return;
		pullingFiles = true;
		try {
			const { failures } = await pullFiles(
				syncTarget.persistentId,
				source,
				opfsSource,
				filesPullable
			);
			if (failures.length) {
				Notifier.error(`${failures.length} file${failures.length === 1 ? '' : 's'} failed to sync`);
			} else {
				Notifier.success(
					`Pulled ${filesPullable.length} file${filesPullable.length === 1 ? '' : 's'}`
				);
			}
			await reloadLedgerFromOpfs();
			await checkFiles(targetId);
		} catch (e) {
			Notifier.error('Pull failed: ' + (e as Error).message);
		} finally {
			pullingFiles = false;
		}
	}

	/** Re-checks item status after a local write (pull/merge) that may have changed what's local. */
	function refreshHashesIfSelected() {
		if (syncTargetId) {
			checkHashes(syncTargetId);
			void checkFiles(syncTargetId);
		}
	}

	/** Item whose Diff is being loaded / that is being pulled — disables just that row's buttons. */
	let diffingItem = $state<SyncItem | null>(null);
	let pullingItem = $state<SyncItem | null>(null);
	let pullConfirmItem = $state<SyncItem | null>(null);

	const ITEM_LABELS: Record<SyncItem, string> = {
		settings: 'Settings'
	};

	// ─── Modal state ─────────────────────────────────────────────────────────────

	let showDiff = $state(false);
	let diffSections = $state<RawDiffSection[]>([]);

	// ─── Mount ───────────────────────────────────────────────────────────────────

	onMount(async () => {
		await peerConnection.ensureInit();
		// Join the saved room automatically; the Connect button is for manual control.
		if (!presence.isInRoom) await joinPeerRoom(presence.roomCode, true);
	});

	// ─── Connection ─────────────────────────────────────────────────────────────
	// Name, room and network are edited on /peer-sync/setup.

	async function joinPeerRoom(code: string, silent = false) {
		if (!code.trim() || presence.isInRoom) return;
		connecting = true;
		try {
			await peerConnection.connect(code);
			if (!silent) Notifier.success('Connected');
		} catch (e) {
			Notifier.error('Failed to connect: ' + (e as Error).message);
		} finally {
			connecting = false;
		}
	}

	async function leaveRoom() {
		connecting = true;
		try {
			await peerConnection.disconnect();
			syncTargetId = null;
			Notifier.info('Disconnected');
		} finally {
			connecting = false;
		}
	}

	let rescanning = $state(false);

	/** Leaves and rejoins the room to force fresh peer discovery — WiFi-local
	 *  peers sometimes both connect to the relay without ever seeing each
	 *  other's announce (relay race/drop); this gives the same recovery a
	 *  full page refresh does, without the reload. */
	async function rescanRoom() {
		if (!presence.isInRoom || rescanning) return;
		rescanning = true;
		try {
			await peerConnection.rescan();
		} catch (e) {
			Notifier.error('Rescan failed: ' + (e as Error).message);
		} finally {
			rescanning = false;
		}
	}

	/** Connect slider in the Connection card. */
	async function toggleConnection() {
		if (presence.isInRoom) {
			await leaveRoom();
		} else {
			await joinPeerRoom(presence.roomCode);
		}
	}

	// ─── Trust ───────────────────────────────────────────────────────────────────

	// The pairing prompt is opened explicitly ("Pair") rather than popping up
	// for every stranger in a shared room. Derived from `peersMap` so the code
	// shown is always the live one, and the prompt closes if the peer leaves.
	let pairingTargetId = $state<string | null>(null);
	let pairingPeer = $derived(pairingTargetId ? (presence.peersMap[pairingTargetId] ?? null) : null);
	$effect(() => {
		if (pairingPeer?.isTrusted) pairingTargetId = null;
	});

	/** "12345678" → "1234 5678" */
	function groupCode(code: string): string {
		return code.replace(/(\d{4})(?=\d)/g, '$1 ');
	}

	async function trustPeer(peer: ActivePeer) {
		try {
			await presence.trust(peer);
			Notifier.success(`Trusted "${peer.name}"`);
		} catch (e) {
			Notifier.error(e instanceof Error ? e.message : String(e));
		}
	}

	// ─── Sync actions ─────────────────────────────────────────────────────────────

	function fetchRemoteData(files: string[]): Promise<RemoteData> {
		if (!syncTargetId) return Promise.reject(new Error('No peer selected'));
		return peerConnection.fetchRemoteData(syncTargetId, files);
	}

	async function openDiff(item: SyncItem) {
		if (!syncTarget || diffingItem) return;
		diffingItem = item;
		try {
			const [remote, local] = await Promise.all([fetchRemoteData([item]), getLocalData([item])]);
			const sections: RawDiffSection[] = [];
			if (item === 'settings' && remote.settings !== null && local.settings !== null) {
				sections.push({
					filename: 'settings.json',
					kind: 'settings',
					local: JSON.parse(local.settings) as Setting[],
					remote: JSON.parse(remote.settings) as Setting[]
				});
			}
			diffSections = sections;
			showDiff = true;
		} catch (e) {
			Notifier.error((e as Error).message);
		} finally {
			diffingItem = null;
		}
	}

	async function confirmPull() {
		const item = pullConfirmItem;
		pullConfirmItem = null;
		if (!syncTarget || !item) return;
		pullingItem = item;
		try {
			const remote = await fetchRemoteData([item]);
			if (item === 'settings' && remote.settings !== null) {
				const entries: Setting[] = JSON.parse(remote.settings);
				await db.settings.clear();
				await db.settings.bulkPut(entries.map((e) => new Setting(e.key, e.value)));
				Notifier.success('Settings updated');
			}
			refreshHashesIfSelected();
		} catch (e) {
			Notifier.error('Pull failed: ' + (e as Error).message);
		} finally {
			pullingItem = null;
		}
	}

	let applyingSettingsMerge = $state(false);

	/** Writes a keyed Theirs/Mine merge of Settings — see JsonMergeViewer/keyedMerge.ts. */
	async function applySettingsMerge(merged: Setting[]) {
		applyingSettingsMerge = true;
		try {
			await db.settings.clear();
			await db.settings.bulkPut(merged.map((s) => new Setting(s.key, s.value)));
			Notifier.success('Settings: merge applied.');
			showDiff = false;
			refreshHashesIfSelected();
		} catch (e) {
			Notifier.error(`Merge failed: ${(e as Error).message}`);
		} finally {
			applyingSettingsMerge = false;
		}
	}

</script>

{#snippet hashBadge(status: HashStatus | null)}
	{#if status === 'checking'}
		<span class="loading loading-spinner loading-xs opacity-60" aria-label="Checking…"></span>
	{:else if status === 'same'}
		<span class="badge badge-success badge-xs">Same</span>
	{:else if status === 'different'}
		<span class="badge badge-warning badge-xs">Different</span>
	{:else if status === 'error'}
		<span class="badge badge-ghost badge-xs" title="Could not compare (peer offline or unreachable)"
			>?</span
		>
	{/if}
{/snippet}

<main class="flex h-full flex-col">
	<Toolbar title="Peer Sync">
		{#snippet actions()}
			<a
				href="/peer-sync/setup"
				class="btn btn-ghost btn-sm btn-square"
				aria-label="Setup"
				title="Setup"
			>
				<SettingsIcon size={20} />
			</a>
			<HelpButton topic="peer-sync" />
		{/snippet}
	</Toolbar>
	<section class="flex-1 space-y-3 overflow-y-auto touch-pan-y p-4">
		<!-- Connection — identity, room status and peers in one card. The room is
		     joined automatically on open; the button is for manual control. -->
		<div class="card bg-base-200 shadow-sm">
			<div class="card-body gap-3 p-4">
				<div class="flex items-center gap-3">
					{#if presence.isInRoom}
						<PlugZap size={24} class="text-success shrink-0" />
					{:else}
						<Unplug size={24} class="text-warning shrink-0" />
					{/if}
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1 text-sm">
							<span class="truncate">
								<span class="font-semibold">{presence.myName || '…'}</span>
								<span class="opacity-40">· Room:</span>
								<span class="font-mono">{presence.roomCode || '—'}</span>
							</span>
						</div>
						<div class="flex items-center gap-1 text-xs opacity-60">
							{#if connecting}
								{presence.isInRoom ? 'Disconnecting…' : 'Connecting…'}
							{:else if presence.isInRoom}
								Connected · {presence.activePeerList.length}
								{presence.activePeerList.length === 1 ? 'peer' : 'peers'}
								<button
									class="btn btn-ghost btn-sm btn-square -my-1.5"
									aria-label="Rescan for peers"
									title="Rescan for peers"
									disabled={rescanning}
									onclick={rescanRoom}
								>
									<RefreshCwIcon size={16} class={rescanning ? 'animate-spin' : ''} />
								</button>
							{:else}
								Not connected
							{/if}
						</div>
					</div>
					{#if connecting}
						<span class="loading loading-spinner loading-md"></span>
					{:else}
						<input
							type="checkbox"
							class="toggle toggle-success toggle-lg bg-transparent bg-none"
							checked={presence.isInRoom}
							aria-label={presence.isInRoom ? 'Disconnect' : 'Connect'}
							onchange={toggleConnection}
						/>
					{/if}
				</div>

				{#if presence.isInRoom}
					{#if presence.activePeerList.length === 0}
						<p class="text-sm opacity-50">Waiting for other devices…</p>
					{:else}
						<ul class="space-y-2" role="radiogroup" aria-label="Sync source">
							{#each presence.activePeerList as peer (peer.trysteroId)}
								{@const selected = peer.isTrusted && syncTargetId === peer.trysteroId}
								<li>
									{#if peer.isTrusted}
										<button
											type="button"
											role="radio"
											aria-checked={selected}
											class="rounded-box flex w-full items-center gap-2 p-3 text-left transition-colors"
											class:bg-primary={selected}
											class:text-primary-content={selected}
											class:bg-base-300={!selected}
											onclick={() => (syncTargetId = peer.trysteroId)}
										>
											{#if selected}
												<CircleCheck size={16} class="shrink-0" />
											{:else}
												<Circle size={16} class="shrink-0 opacity-40" />
											{/if}
											<span class="font-semibold flex-1">{peer.name}</span>
											<span
												class="badge badge-sm"
												class:badge-success={!selected}
												class:badge-outline={selected}>Trusted</span
											>
										</button>
									{:else}
										<div class="bg-base-300 rounded-box flex items-center gap-2 p-3">
											<span class="font-semibold flex-1">{peer.name}</span>
											{#if peer.peerConfirmed}
												<span class="badge badge-warning badge-sm">Wants to pair</span>
											{/if}
											<button
												class="btn btn-primary btn-sm"
												onclick={() => (pairingTargetId = peer.trysteroId)}
											>
												Pair
											</button>
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
		</div>

		<!-- Sync Panel -->
		{#if syncTarget}
			<div class="card bg-base-200 shadow-sm">
				<div class="card-body p-4">
					<div class="flex items-center justify-between gap-2">
						<h2 class="card-title text-sm">Sync from "{syncTarget.name}"</h2>
						<button
							class="btn btn-ghost btn-xs"
							aria-label="Refresh comparison"
							title="Refresh comparison"
							disabled={hashStatus.settings === 'checking'}
							onclick={refreshHashesIfSelected}
						>
							<RefreshCwIcon
								size={14}
								class={hashStatus.settings === 'checking' ? 'animate-spin' : ''}
							/>
						</button>
					</div>

					<div class="flex flex-col gap-1">
						{#each ['settings'] as const as item (item)}
							{@const status = hashStatus[item]}
							<div class="flex items-center gap-2 py-1">
								<span class="flex-1 text-sm">{ITEM_LABELS[item]}</span>
								{@render hashBadge(status)}
								<button
									class="btn btn-sm btn-square btn-accent text-secondary"
									aria-label="Diff {ITEM_LABELS[item]}"
									title="Diff"
									disabled={status !== 'different' || diffingItem !== null}
									onclick={() => openDiff(item)}
								>
									{#if diffingItem === item}<span class="loading loading-spinner loading-xs"
											></span>{:else}<GitCompareArrowsIcon size={16} />{/if}
								</button>
								<button
									class="btn btn-sm btn-square btn-primary"
									aria-label="Pull {ITEM_LABELS[item]}"
									title="Pull"
									disabled={status !== 'different' || pullingItem !== null}
									onclick={() => (pullConfirmItem = item)}
								>
									{#if pullingItem === item}<span class="loading loading-spinner loading-xs"
											></span>{:else}<DownloadIcon size={16} />{/if}
								</button>
							</div>
						{/each}

						<div class="flex items-center gap-2 py-1">
							<span class="flex-1 text-sm">Local Transactions</span>
							{@render hashBadge(ydocStatus)}
							<!-- Merged automatically (CRDT), so no Diff — Sync pulls and merges. -->
							<button
								class="btn btn-sm btn-square btn-primary"
								aria-label="Sync Local Transactions"
								title="Pull &amp; merge"
								disabled={syncingYdoc || ydocStatus !== 'different'}
								onclick={syncLocalTransactions}
							>
								{#if syncingYdoc}<span class="loading loading-spinner loading-xs"
										></span>{:else}<DownloadIcon size={16} />{/if}
							</button>
						</div>

						<div class="flex items-center gap-2 py-1">
							<span class="flex-1 text-sm">Scheduled Transactions</span>
							{@render hashBadge(scxStatus)}
							<!-- Merged automatically (CRDT), so no Diff — Sync pulls and merges. -->
							<button
								class="btn btn-sm btn-square btn-primary"
								aria-label="Sync Scheduled Transactions"
								title="Pull &amp; merge"
								disabled={syncingScx || scxStatus !== 'different'}
								onclick={syncScheduledTransactions}
							>
								{#if syncingScx}<span class="loading loading-spinner loading-xs"
										></span>{:else}<DownloadIcon size={16} />{/if}
							</button>
						</div>
					</div>

					<!-- Journal files: status + pull-all-newer here; the link leads to the whole-file sync page for per-file review and conflicts. -->
					<div class="divider my-0"></div>
					<div class="flex items-center gap-2">
						<a
							href="/sync/beancount?peer={syncTarget.persistentId}"
							class="btn btn-ghost btn-sm flex-1 justify-between px-1"
						>
							<span class="flex items-center gap-2">
								<FolderSyncIcon size={14} />
								Journal files
							</span>
							<span class="flex items-center gap-1">
								{#if filesState?.status === 'checking'}
									{@render hashBadge('checking')}
								{:else if filesState?.status === 'error'}
									{@render hashBadge('error')}
								{:else if filesState}
									{#if filesPullable.length > 0}
										<span class="badge badge-warning badge-xs">{filesPullable.length} newer</span>
									{/if}
									{#if filesConflicts.length > 0}
										<span class="badge badge-error badge-xs">{filesConflicts.length} conflict</span>
									{/if}
									{#if filesPullable.length === 0 && filesConflicts.length === 0}
										{@render hashBadge('same')}
									{/if}
								{/if}
								<ChevronRightIcon size={16} class="opacity-60" />
							</span>
						</a>
						<button
							class="btn btn-sm btn-square btn-primary"
							aria-label="Pull newer journal files"
							title="Pull all newer files"
							disabled={pullingFiles || filesPullable.length === 0}
							onclick={pullNewerFiles}
						>
							{#if pullingFiles}<span class="loading loading-spinner loading-xs"
									></span>{:else}<DownloadIcon size={16} />{/if}
						</button>
					</div>
				</div>
			</div>
		{/if}
	</section>
</main>

<!-- ─── Diff Modal ─────────────────────────────────────────────────────────── -->
{#if showDiff}
	<div class="modal modal-open">
		<div class="modal-box h-[90vh] max-w-3xl flex flex-col p-0">
			<div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
				<h3 class="font-bold">Diff — Local vs {syncTarget?.name}</h3>
				<button class="btn btn-ghost btn-sm" onclick={() => (showDiff = false)}>✕</button>
			</div>
			<div class="flex-1 overflow-y-auto touch-pan-y p-4 flex flex-col gap-6">
				{#each diffSections as section (section.filename)}
					<JsonMergeViewer
						title={section.filename}
						local={section.local}
						remote={section.remote}
						keyOf={(s) => s.key}
						renderEntry={(s) => s.value}
						onApplyMerge={applySettingsMerge}
						applyingMerge={applyingSettingsMerge}
					/>
				{/each}
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => (showDiff = false)}></button>
	</div>
{/if}

<!-- ─── Scheduled Transactions merge report ────────────────────────────────── -->
<!-- Shown once, right after the merge; nothing is stored. -->
{#if scxReport}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">Scheduled Transactions merged</h3>
			<p class="pt-2 text-sm opacity-70">{summarizeScxReport(scxReport)}</p>
			<ul class="my-3 max-h-64 space-y-1 overflow-y-auto text-sm">
				{#each scxReport.lines as line, i (i)}
					<li>{line}</li>
				{/each}
			</ul>
			<div class="modal-action">
				<button class="btn btn-primary" onclick={() => (scxReport = null)}>OK</button>
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => (scxReport = null)}></button>
	</div>
{/if}

<!-- ─── Pairing ────────────────────────────────────────────────────────────── -->
{#if pairingPeer}
	<div class="modal modal-open">
		<div class="modal-box text-center">
			<h3 class="font-bold text-lg">Pair with "{pairingPeer.name}"</h3>
			{#if pairingPeer.pairingCode}
				<p class="py-3 text-sm opacity-70">
					Check that <strong>this exact code</strong> is shown on the other device, then trust it on both.
				</p>
				<p class="font-mono text-4xl font-bold tracking-widest py-3" aria-label="Pairing code">
					{groupCode(pairingPeer.pairingCode)}
				</p>
				{#if pairingPeer.peerConfirmed}
					<p class="text-success text-sm">"{pairingPeer.name}" has confirmed this code.</p>
				{:else}
					<p class="text-xs opacity-60">Waiting for "{pairingPeer.name}" to confirm.</p>
				{/if}
				<p class="text-warning mt-3 text-xs">
					If the codes differ, do not trust — someone may be intercepting the connection.
				</p>
			{:else}
				<p class="py-4 text-sm">
					Couldn't read this connection's security details. Rescan for devices and try again.
				</p>
			{/if}
			<div class="modal-action justify-center">
				<button class="btn btn-ghost" onclick={() => (pairingTargetId = null)}>Cancel</button>
				<button
					class="btn btn-success"
					disabled={!pairingPeer.pairingCode}
					onclick={() => trustPeer(pairingPeer)}
				>
					Codes match — Trust
				</button>
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => (pairingTargetId = null)}
		></button>
	</div>
{/if}

<!-- ─── Pull Confirm ───────────────────────────────────────────────────────── -->
{#if pullConfirmItem}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">Confirm Pull</h3>
			<p class="py-4 text-sm">
				Overwrite local <strong>{ITEM_LABELS[pullConfirmItem]}</strong> with the version from <strong>{syncTarget?.name}</strong>? This cannot
				be undone.
			</p>
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={() => (pullConfirmItem = null)}>Cancel</button>
				<button class="btn btn-warning" onclick={confirmPull}>Overwrite</button>
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => (pullConfirmItem = null)}
		></button>
	</div>
{/if}
