<script lang="ts">
	import { onMount } from 'svelte';
	import JsonMergeViewer from '$lib/components/JsonMergeViewer.svelte';
	import db from '$lib/data/db';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import { Setting, ScheduledTransaction } from '$lib/data/model';
	import Notifier from '$lib/utils/notifier';
	import {
		GitCompareArrowsIcon,
		EyeIcon,
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
	import { reloadLedgerFromOpfs } from '$lib/services/ledgerReload';
	import type { ActivePeer } from '$lib/sync/peerPresence.svelte';
	import {
		peerConnection,
		getLocalData,
		getLocalHashes,
		type RemoteData
	} from '$lib/sync/peerConnection.svelte';

	// ─── Types ───────────────────────────────────────────────────────────────────
	type PreviewSection = { filename: string; content: string };

	/**
	 * Settings/scheduled are JSON — a raw text-hunk splice on JSON risks
	 * producing invalid output wherever a hunk boundary falls inside the
	 * structure (trailing commas, unbalanced braces), so those go through
	 * JsonMergeViewer's keyed (per-entry) merge instead. See keyedMerge.ts.
	 */
	type RawDiffSection =
		| { filename: 'settings.json'; kind: 'settings'; local: Setting[]; remote: Setting[] }
		| {
				filename: 'scheduled.json';
				kind: 'scheduled';
				local: ScheduledTransaction[];
				remote: ScheduledTransaction[];
		  };

	// ─── ScheduledTransaction identity (for JsonMergeViewer's keyed diff) ──────
	// `id` is a device-local auto-increment (not portable across peers) and
	// `amount` is display-only (derived from `transaction`) — both excluded
	// from identity. Two entries are "the same" scheduled transaction iff
	// everything else matches, so a genuine edit surfaces as a remove+add pair
	// rather than a single "changed" entry (`scheduledEqual` is true whenever
	// `scheduledKeyOf` already matched, so `changed` never fires here). Picking
	// "Mine" on the old pair member and "Theirs" on the new one keeps both as
	// separate rows — visible and easy to clean up manually, never a corrupt
	// merge.
	function scheduledIdentity(t: ScheduledTransaction) {
		const { nextDate, transaction, period, count, endDate, remarks, repayment } = t;
		return { nextDate, transaction, period, count, endDate, remarks, repayment };
	}
	function scheduledKeyOf(t: ScheduledTransaction): string {
		return JSON.stringify(scheduledIdentity(t));
	}
	function scheduledEqual(a: ScheduledTransaction, b: ScheduledTransaction): boolean {
		return scheduledKeyOf(a) === scheduledKeyOf(b);
	}
	function scheduledLabel(t: ScheduledTransaction): string {
		return `${t.nextDate} · ${t.transaction?.payee || t.remarks || '(unnamed)'}`;
	}

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
	const ALL_ITEMS = ['settings', 'scheduled'];
	let hashStatus = $state<Record<'settings' | 'scheduled', HashStatus | null>>({
		settings: null,
		scheduled: null
	});

	$effect(() => {
		const targetId = syncTargetId;
		if (!targetId) {
			hashStatus = { settings: null, scheduled: null };
			ydocStatus = null;
			return;
		}
		checkHashes(targetId);
	});

	function itemHashStatus(local: string | null, remote: string | null): HashStatus {
		if (local === null || remote === null) return 'error';
		return local === remote ? 'same' : 'different';
	}

	async function checkHashes(targetId: string) {
		hashStatus = { settings: 'checking', scheduled: 'checking' };
		void checkYdocHash(targetId);
		try {
			const [local, remote] = await Promise.all([
				getLocalHashes(ALL_ITEMS),
				peerConnection.fetchRemoteHashes(targetId, ALL_ITEMS)
			]);
			if (targetId !== syncTargetId) return; // stale — user switched peers meanwhile
			hashStatus = {
				settings: itemHashStatus(local.settings, remote.settings),
				scheduled: itemHashStatus(local.scheduled, remote.scheduled)
			};
		} catch {
			if (targetId !== syncTargetId) return;
			hashStatus = { settings: 'error', scheduled: 'error' };
		}
	}

	// ─── Local Transactions (CRDT store) ──────────────────────────────────────
	// Merged automatically (no diff view), so it's a status plus one Sync action.
	// Hidden when this device uses the OPFS store (local hash is null).
	let ydocStatus = $state<HashStatus | null>(null);
	let hasLocalYdoc = $state(false);
	let syncingYdoc = $state(false);

	async function checkYdocHash(targetId: string) {
		ydocStatus = 'checking';
		try {
			const local = await peerConnection.getLocalYdocHash();
			hasLocalYdoc = local !== null;
			if (!hasLocalYdoc) {
				ydocStatus = null;
				return;
			}
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

	/** Re-checks item status after a local write (pull/merge) that may have changed what's local. */
	function refreshHashesIfSelected() {
		if (syncTargetId) checkHashes(syncTargetId);
	}

	let includeSettings = $state(false);
	let includeScheduled = $state(false);
	let noneSelected = $derived(!includeSettings && !includeScheduled);
	let allSelected = $derived(includeSettings && includeScheduled);
	let indeterminate = $state(false);
	$effect(() => {
		indeterminate = (includeSettings || includeScheduled) && !allSelected;
	});

	function toggleSelectAll() {
		const next = !allSelected;
		includeSettings = next;
		includeScheduled = next;
	}

	function selectedFiles(): string[] {
		const f: string[] = [];
		if (includeSettings) f.push('settings');
		if (includeScheduled) f.push('scheduled');
		return f;
	}

	let isFetching = $state(false);
	let isPulling = $state(false);

	// ─── Modal state ─────────────────────────────────────────────────────────────

	let showDiff = $state(false);
	let showPreview = $state(false);
	let showPullConfirm = $state(false);
	let diffSections = $state<RawDiffSection[]>([]);
	let previewSections = $state<PreviewSection[]>([]);

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

	async function openPreview() {
		if (!syncTarget || noneSelected) return;
		isFetching = true;
		try {
			const files = selectedFiles();
			const remote = await fetchRemoteData(files);
			const sections: PreviewSection[] = [];
			if (remote.settings !== null)
				sections.push({ filename: 'settings.json', content: remote.settings });
			if (remote.scheduled !== null)
				sections.push({ filename: 'scheduled.json', content: remote.scheduled });
			previewSections = sections;
			showPreview = true;
		} catch (e) {
			Notifier.error((e as Error).message);
		} finally {
			isFetching = false;
		}
	}

	async function openDiff() {
		if (!syncTarget || noneSelected) return;
		isFetching = true;
		try {
			const files = selectedFiles();
			const [remote, local] = await Promise.all([fetchRemoteData(files), getLocalData(files)]);
			const sections: RawDiffSection[] = [];
			if (remote.settings !== null && local.settings !== null) {
				sections.push({
					filename: 'settings.json',
					kind: 'settings',
					local: JSON.parse(local.settings) as Setting[],
					remote: JSON.parse(remote.settings) as Setting[]
				});
			}
			if (remote.scheduled !== null && local.scheduled !== null) {
				sections.push({
					filename: 'scheduled.json',
					kind: 'scheduled',
					local: JSON.parse(local.scheduled) as ScheduledTransaction[],
					remote: JSON.parse(remote.scheduled) as ScheduledTransaction[]
				});
			}
			diffSections = sections;
			showDiff = true;
		} catch (e) {
			Notifier.error((e as Error).message);
		} finally {
			isFetching = false;
		}
	}

	async function confirmPull() {
		if (!syncTarget || noneSelected) return;
		isPulling = true;
		showPullConfirm = false;
		try {
			const remote = await fetchRemoteData(selectedFiles());
			if (remote.settings !== null) {
				const entries: Setting[] = JSON.parse(remote.settings);
				await db.settings.clear();
				await db.settings.bulkPut(entries.map((e) => new Setting(e.key, e.value)));
				Notifier.success('Settings updated');
			}
			if (remote.scheduled !== null) {
				const entries: ScheduledTransaction[] = JSON.parse(remote.scheduled);
				await db.scheduled.clear();
				await db.scheduled.bulkPut(entries);
				Notifier.success('Scheduled transactions updated');
			}
			refreshHashesIfSelected();
		} catch (e) {
			Notifier.error('Pull failed: ' + (e as Error).message);
		} finally {
			isPulling = false;
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

	let applyingScheduledMerge = $state(false);

	/**
	 * Writes a keyed Theirs/Mine merge of ScheduledTransactions. `local` is the
	 * exact array diffed against (same object references `merged` was built
	 * from) — kept-local items pass through by reference and already carry a
	 * valid local `id`; anything else (a remote-origin item) gets its `id`
	 * stripped so Dexie assigns a fresh one instead of colliding with an
	 * unrelated local row that happens to reuse the same device-local number.
	 */
	async function applyScheduledMerge(
		local: ScheduledTransaction[],
		merged: ScheduledTransaction[]
	) {
		applyingScheduledMerge = true;
		try {
			const localSet = new Set(local);
			const rows = merged.map((t) => (localSet.has(t) ? t : { ...t, id: undefined }));
			await db.scheduled.clear();
			await db.scheduled.bulkPut(rows);
			showDiff = false;
			refreshHashesIfSelected();
		} catch (e) {
			Notifier.error(`Merge failed: ${(e as Error).message}`);
		} finally {
			applyingScheduledMerge = false;
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

					<div class="flex flex-col gap-2 py-1">
						<label class="flex items-center gap-3 cursor-pointer">
							<input
								type="checkbox"
								class="checkbox checkbox-primary checkbox-sm"
								checked={allSelected}
								bind:indeterminate
								onclick={toggleSelectAll}
							/>
							<span class="text-xs opacity-60">Select all</span>
						</label>
						<div class="divider my-0"></div>
						<label class="flex items-center gap-3 cursor-pointer">
							<input
								type="checkbox"
								class="checkbox checkbox-primary checkbox-sm"
								bind:checked={includeSettings}
							/>
							<span class="flex-1 text-sm">Settings</span>
							{@render hashBadge(hashStatus.settings)}
						</label>
						<label class="flex items-center gap-3 cursor-pointer">
							<input
								type="checkbox"
								class="checkbox checkbox-primary checkbox-sm"
								bind:checked={includeScheduled}
							/>
							<span class="flex-1 text-sm">Scheduled Transactions</span>
							{@render hashBadge(hashStatus.scheduled)}
						</label>
					</div>

					{#if hasLocalYdoc}
						<div class="flex items-center gap-3 py-1">
							<span class="flex-1 text-sm">Local Transactions</span>
							{@render hashBadge(ydocStatus)}
							<button
								class="btn btn-sm btn-primary"
								disabled={syncingYdoc || ydocStatus === 'same'}
								onclick={syncLocalTransactions}
							>
								{#if syncingYdoc}<span class="loading loading-spinner loading-xs"></span>{/if}
								Sync
							</button>
						</div>
					{/if}

					<div class="flex gap-2 flex-wrap pt-1">
						<button
							class="btn btn-sm btn-outline flex-1"
							disabled={noneSelected || isFetching}
							onclick={openPreview}
						>
							{#if isFetching}<span class="loading loading-spinner loading-xs"
								></span>{:else}<EyeIcon size={14} />{/if}
							Preview
						</button>
						<button
							class="btn btn-sm btn-accent text-secondary flex-1"
							disabled={noneSelected || isFetching}
							onclick={openDiff}
						>
							{#if isFetching}<span class="loading loading-spinner loading-xs"
								></span>{:else}<GitCompareArrowsIcon size={14} />{/if}
							Diff
						</button>
						<button
							class="btn btn-sm btn-primary flex-1"
							disabled={noneSelected || isPulling}
							onclick={() => (showPullConfirm = true)}
						>
							{#if isPulling}<span class="loading loading-spinner loading-xs"
								></span>{:else}<DownloadIcon size={14} />{/if}
							Pull
						</button>
					</div>

					<!-- Leads to a different context (whole-file sync), so it sits apart and reads as navigation. -->
					<div class="divider my-0"></div>
					<a
						href="/sync/beancount?peer={syncTarget.persistentId}"
						class="btn btn-ghost btn-sm w-full justify-between"
					>
						<span class="flex items-center gap-2">
							<FolderSyncIcon size={14} />
							Sync journal files
						</span>
						<ChevronRightIcon size={16} class="opacity-60" />
					</a>
				</div>
			</div>
		{/if}
	</section>
</main>

<!-- ─── Preview Modal ──────────────────────────────────────────────────────── -->
{#if showPreview}
	<div class="modal modal-open">
		<div class="modal-box h-[90vh] max-w-3xl flex flex-col p-0">
			<div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
				<h3 class="font-bold">Preview — {syncTarget?.name}</h3>
				<button class="btn btn-ghost btn-sm" onclick={() => (showPreview = false)}>✕</button>
			</div>
			<div class="flex-1 overflow-y-auto touch-pan-y p-4 flex flex-col gap-6">
				{#each previewSections as section}
					<div>
						<p class="font-mono text-sm font-semibold mb-1 opacity-60">{section.filename}</p>
						<pre
							class="text-xs font-mono leading-5 overflow-x-auto rounded bg-base-200 p-2 select-text whitespace-pre">{section.content}</pre>
					</div>
				{/each}
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => (showPreview = false)}
		></button>
	</div>
{/if}

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
					{#if section.kind === 'settings'}
						<JsonMergeViewer
							title={section.filename}
							local={section.local}
							remote={section.remote}
							keyOf={(s) => s.key}
							renderEntry={(s) => s.value}
							onApplyMerge={applySettingsMerge}
							applyingMerge={applyingSettingsMerge}
						/>
					{:else}
						<JsonMergeViewer
							title={section.filename}
							local={section.local}
							remote={section.remote}
							keyOf={scheduledKeyOf}
							equal={scheduledEqual}
							labelOf={scheduledLabel}
							onApplyMerge={(merged) => applyScheduledMerge(section.local, merged)}
							applyingMerge={applyingScheduledMerge}
						/>
					{/if}
				{/each}
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => (showDiff = false)}></button>
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
{#if showPullConfirm}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">Confirm Pull</h3>
			<p class="py-4 text-sm">
				Overwrite local data with the version from <strong>{syncTarget?.name}</strong>? This cannot
				be undone.
			</p>
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={() => (showPullConfirm = false)}>Cancel</button>
				<button class="btn btn-warning" onclick={confirmPull}>Overwrite</button>
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => (showPullConfirm = false)}
		></button>
	</div>
{/if}
