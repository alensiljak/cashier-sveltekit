<script lang="ts">
	import { onMount } from 'svelte';
	import JsonMergeViewer from '$lib/components/JsonMergeViewer.svelte';
	import db from '$lib/data/db';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import { Setting, ScheduledTransaction } from '$lib/data/model';
	import Notifier from '$lib/utils/notifier';
	import {
		GitCompareArrowsIcon,
		EyeIcon,
		DownloadIcon,
		Check,
		RefreshCwIcon,
		PencilIcon,
		XIcon,
		Circle,
		CircleCheck
	} from '@lucide/svelte';
	import {
		RELAY_STRATEGIES,
		type ActivePeer,
		type RelayStrategy
	} from '$lib/sync/peerPresence.svelte';
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
	let editingConfig = $state(false);
	let nameInput = $state('');
	let roomInput = $state('cashier');
	let connecting = $state(false);

	// ─── Sync UI ─────────────────────────────────────────────────────────────────

	let syncTargetId = $state<string | null>(null); // trysteroId of selected peer
	let syncTarget = $derived(syncTargetId ? presence.peersMap[syncTargetId] : null);

	// Selected peer disappeared from the room — drop the stale selection.
	$effect(() => {
		if (syncTargetId && !presence.peersMap[syncTargetId]) syncTargetId = null;
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

	function formatDate(iso: string | undefined = undefined): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleString();
	}

	// ─── Mount ───────────────────────────────────────────────────────────────────

	onMount(async () => {
		await peerConnection.ensureInit();
	});

	// ─── Identity & Room ────────────────────────────────────────────────────────

	function startEditConfig() {
		nameInput = presence.myName;
		roomInput = presence.roomCode;
		editingConfig = true;
	}

	function cancelEditConfig() {
		editingConfig = false;
	}

	async function saveConfig() {
		const trimmedName = nameInput.trim();
		if (trimmedName && trimmedName !== presence.myName) {
			await presence.setName(trimmedName);
		}
		const trimmedRoom = roomInput.trim();
		if (trimmedRoom && trimmedRoom !== presence.roomCode) {
			if (presence.isInRoom) await leaveRoom();
			await joinPeerRoom(trimmedRoom);
		}
		editingConfig = false;
		Notifier.success('Saved');
	}

	async function joinPeerRoom(code: string) {
		if (!code.trim() || presence.isInRoom) return;
		connecting = true;
		try {
			await peerConnection.connect(code);
			Notifier.success('Connected');
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

	/** Slider at the top of the page — the only way to connect/disconnect from this page. */
	async function toggleConnection() {
		if (presence.isInRoom) {
			await leaveRoom();
		} else {
			await joinPeerRoom(presence.roomCode);
		}
	}

	// ─── Relay strategy ──────────────────────────────────────────────────────────

	/** Switches the signaling network. Reconnects a live room so the new strategy takes effect immediately. */
	async function selectStrategy(value: RelayStrategy) {
		await peerConnection.setStrategy(value);
	}

	// ─── Trust ───────────────────────────────────────────────────────────────────

	async function trustPeer(peer: ActivePeer) {
		await presence.trust(peer);
		Notifier.success(`Trusted "${peer.name}"`);
	}

	async function removeTrust(persistentId: string) {
		await presence.removeTrust(persistentId);
		if (syncTarget?.persistentId === persistentId) syncTargetId = null;
		Notifier.info('Trust removed');
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
			Notifier.success('Scheduled transactions: merge applied.');
			showDiff = false;
			refreshHashesIfSelected();
		} catch (e) {
			Notifier.error(`Merge failed: ${(e as Error).message}`);
		} finally {
			applyingScheduledMerge = false;
		}
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
	<Toolbar title="Peer Sync" {menuItems}>
		{#snippet actions()}
			<HelpButton topic="peer-sync" />
		{/snippet}
	</Toolbar>
	<section class="flex-1 space-y-3 overflow-y-auto touch-pan-y p-4">
		<!-- Identity/room — one-liner, edit icon toggles both fields into an editable row. -->
		<div class="card bg-base-200 shadow-sm">
			<div class="card-body flex-row items-center gap-2 p-3">
				{#if editingConfig}
					<input
						type="text"
						bind:value={nameInput}
						class="input input-bordered input-sm min-w-0 flex-1"
						placeholder="My Phone"
						aria-label="Device name"
						onkeydown={(e) => e.key === 'Enter' && saveConfig()}
					/>
					<input
						type="text"
						bind:value={roomInput}
						class="input input-bordered input-sm min-w-0 flex-1 font-mono"
						placeholder="cashier"
						aria-label="Room"
						onkeydown={(e) => e.key === 'Enter' && saveConfig()}
					/>
					<button
						class="btn btn-success btn-xs"
						aria-label="Save"
						title="Save"
						onclick={saveConfig}
					>
						<Check size={14} />
					</button>
					<button
						class="btn btn-ghost btn-xs"
						aria-label="Cancel"
						title="Cancel"
						onclick={cancelEditConfig}
					>
						<XIcon size={14} />
					</button>
				{:else}
					<div class="min-w-0 flex-1 truncate text-sm">
						{#if presence.isInRoom}
							<span class="status status-success status-xs mr-1"></span>
						{:else}
							<span class="status status-warning status-xs mr-1"></span>
						{/if}
						<span class="font-semibold">{presence.myName || '…'}</span>
						<span class="opacity-40">· Room:</span>
						<span class="font-mono">{presence.roomCode || '—'}</span>
						<span class="opacity-40">·</span>
						<span class="font-mono text-xs opacity-40">ID: {presence.myId}</span>
					</div>
					<button
						class="btn btn-warning btn-outline btn-xs"
						aria-label="Edit device name and room"
						title="Edit device name and room"
						onclick={startEditConfig}
					>
						<PencilIcon size={14} />
					</button>
				{/if}
			</div>
		</div>

		<!-- Connect toggle — the only way to join/leave the room from this page.
		     Stays connected across navigation to other pages; only this toggle
		     or leaving the app disconnects. -->
		<div class="card bg-base-200 shadow-sm">
			<div class="card-body flex-row items-center justify-between gap-3 p-4">
				<div>
					<p class="font-semibold">Connect</p>
					<p class="text-xs opacity-60">
						{#if connecting}
							{presence.isInRoom ? 'Disconnecting…' : 'Connecting…'}
						{:else if presence.isInRoom}
							Connected — stays active while you browse other pages
						{:else}
							Not connected
						{/if}
					</p>
				</div>
				{#if connecting}
					<span class="loading loading-spinner loading-sm"></span>
				{:else}
					<input
						type="checkbox"
						class="toggle toggle-success"
						checked={presence.isInRoom}
						aria-label={presence.isInRoom ? 'Disconnect' : 'Connect'}
						onchange={toggleConnection}
					/>
				{/if}
			</div>
		</div>

		<!-- Active Peers in Room -->
		{#if presence.isInRoom}
			<div class="card bg-base-200 shadow-sm">
				<div class="card-body p-4">
					<h2 class="card-title text-sm">
						Peers in Room
						<span class="badge badge-neutral badge-sm">{presence.activePeerList.length}</span>
					</h2>

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
										<div class="bg-base-300 rounded-box p-3">
											<div class="flex items-center gap-2">
												<span class="font-semibold flex-1">{peer.name}</span>
											</div>
											<div class="mt-2 rounded bg-warning/15 p-2 text-sm">
												<p class="text-xs font-medium opacity-70">
													Confirm pairing code on both devices:
												</p>
												<p class="font-mono text-2xl font-bold tracking-[0.25em]">
													{peer.pairingCode}
												</p>
											</div>
											<button
												class="btn btn-success btn-sm mt-2 w-full"
												onclick={() => trustPeer(peer)}
											>
												Trust This Device
											</button>
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		{/if}

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
							<RefreshCwIcon size={14} class={hashStatus.settings === 'checking' ? 'animate-spin' : ''} />
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

					<a
						href="/sync/beancount?peer={syncTarget.persistentId}"
						class="link link-primary text-xs block py-2 text-center"
					>
						Sync journal files →
					</a>

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
				</div>
			</div>
		{/if}

		<!-- Trusted Devices -->
		<div class="collapse collapse-arrow bg-base-200 rounded-box">
			<input type="checkbox" />
			<div class="collapse-title text-sm font-medium py-2">
				Trusted Devices
				<span class="badge badge-neutral badge-sm ml-1">{presence.trustedPeers.length}</span>
			</div>
			<div class="collapse-content pt-0">
				{#if presence.trustedPeers.length === 0}
					<p class="text-sm opacity-50">No trusted devices yet.</p>
				{:else}
					<ul class="divide-base-300 divide-y">
						{#each presence.trustedPeers as tp (tp.id)}
							<li class="flex items-start justify-between gap-2 py-2">
								<div class="min-w-0 flex-1">
									<p class="font-semibold text-sm">{tp.name}</p>
									<p class="font-mono text-xs opacity-40 break-all">{tp.id}</p>
									<p class="text-xs opacity-40">
										Trusted: {formatDate(tp.trustedAt)} · Seen: {formatDate(tp.lastSeen)}
									</p>
								</div>
								<button
									class="btn btn-ghost btn-xs text-error shrink-0"
									onclick={() => removeTrust(tp.id)}
								>
									Remove
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
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
