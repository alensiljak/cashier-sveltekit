<script lang="ts">
	import { onMount } from 'svelte';
	import DiffViewer from '$lib/components/DiffViewer.svelte';
	import JsonMergeViewer from '$lib/components/JsonMergeViewer.svelte';
	import db from '$lib/data/db';
	import { saveFile } from '$lib/utils/opfslib';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import { Setting, ScheduledTransaction } from '$lib/data/model';
	import Notifier from '$lib/utils/notifier';
	import { GitCompareArrowsIcon, EyeIcon, DownloadIcon, Check } from '@lucide/svelte';
	import {
		RELAY_STRATEGIES,
		type ActivePeer,
		type RelayStrategy
	} from '$lib/sync/peerPresence.svelte';
	import { peerConnection, getLocalData, type RemoteData } from '$lib/sync/peerConnection.svelte';

	// ─── Types ───────────────────────────────────────────────────────────────────
	type PreviewSection = { filename: string; content: string };

	/**
	 * One file's raw local/remote content for the Diff modal. `cashier.bean` is
	 * line-oriented (append-only transaction blocks) so DiffViewer's per-hunk
	 * text merge is safe there. Settings/scheduled are JSON — a raw text-hunk
	 * splice on JSON risks producing invalid output wherever a hunk boundary
	 * falls inside the structure (trailing commas, unbalanced braces), so
	 * those go through JsonMergeViewer's keyed (per-entry) merge instead. See
	 * keyedMerge.ts.
	 */
	type RawDiffSection =
		| { filename: 'cashier.bean'; kind: 'text'; local: string; remote: string }
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
	let editingName = $state(false);
	let nameInput = $state('');
	let editingRoom = $state(false);
	let roomInput = $state('cashier');
	let configExpanded = $state(true);
	let connecting = $state(false);

	// ─── Sync UI ─────────────────────────────────────────────────────────────────

	let syncTargetId = $state<string | null>(null); // trysteroId of selected peer
	let syncTarget = $derived(syncTargetId ? presence.peersMap[syncTargetId] : null);

	// Selected peer disappeared from the room — drop the stale selection.
	$effect(() => {
		if (syncTargetId && !presence.peersMap[syncTargetId]) syncTargetId = null;
	});

	let includeCashierBean = $state(false);
	let includeSettings = $state(false);
	let includeScheduled = $state(false);
	let noneSelected = $derived(!includeCashierBean && !includeSettings && !includeScheduled);
	let allSelected = $derived(includeCashierBean && includeSettings && includeScheduled);
	let indeterminate = $state(false);
	$effect(() => {
		indeterminate = (includeCashierBean || includeSettings || includeScheduled) && !allSelected;
	});

	function toggleSelectAll() {
		const next = !allSelected;
		includeCashierBean = next;
		includeSettings = next;
		includeScheduled = next;
	}

	function selectedFiles(): string[] {
		const f: string[] = [];
		if (includeCashierBean) f.push('bean');
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
		nameInput = presence.myName;
		roomInput = presence.roomCode;

		// Auto-collapse config if already configured
		if (presence.myName !== 'My Device' && presence.roomCode) configExpanded = false;
	});

	// ─── Identity ────────────────────────────────────────────────────────────────

	async function saveName() {
		const trimmed = nameInput.trim();
		if (!trimmed) return;
		await presence.setName(trimmed);
		editingName = false;
		Notifier.success('Name saved');
	}

	// ─── Room ────────────────────────────────────────────────────────────────────

	async function changeRoom() {
		const trimmed = roomInput.trim();
		if (!trimmed || trimmed === presence.roomCode) {
			editingRoom = false;
			return;
		}
		if (presence.isInRoom) await leaveRoom();
		editingRoom = false;
		await joinPeerRoom(trimmed);
	}

	async function joinPeerRoom(code: string) {
		if (!code.trim() || presence.isInRoom) return;
		connecting = true;
		try {
			await peerConnection.connect(code);
			configExpanded = false;
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
			if (remote.bean !== null) sections.push({ filename: 'cashier.bean', content: remote.bean });
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
			if (remote.bean !== null && local.bean !== null) {
				sections.push({
					filename: 'cashier.bean',
					kind: 'text',
					local: local.bean,
					remote: remote.bean
				});
			}
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
			if (remote.bean !== null) {
				await saveFile('cashier.bean', remote.bean);
				Notifier.success('cashier.bean updated');
			}
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
		} catch (e) {
			Notifier.error('Pull failed: ' + (e as Error).message);
		} finally {
			isPulling = false;
		}
	}

	let applyingCashierMerge = $state(false);

	/** Writes a hunk-level Theirs/Mine merge of cashier.bean straight to OPFS — see DiffViewer. */
	async function applyCashierMerge(mergedContent: string) {
		applyingCashierMerge = true;
		try {
			await saveFile('cashier.bean', mergedContent);
			Notifier.success('cashier.bean: merge applied.');
			showDiff = false;
		} catch (e) {
			Notifier.error(`Merge failed: ${(e as Error).message}`);
		} finally {
			applyingCashierMerge = false;
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

<main class="flex h-full flex-col">
	<Toolbar title="Peer Sync" {menuItems}>
		{#snippet actions()}
			<HelpButton topic="peer-sync" />
		{/snippet}
	</Toolbar>
	<section class="flex-1 space-y-3 overflow-y-auto touch-pan-y p-4">
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

		<!-- Config collapse -->
		<div class="collapse collapse-arrow bg-base-200 rounded-box">
			<input type="checkbox" bind:checked={configExpanded} />
			<div class="collapse-title flex items-center gap-2 py-2 pr-10 font-medium">
				<span class="font-semibold">{presence.myName || '…'}</span>
				<span class="text-base-content/40">·</span>
				<span class="font-mono text-sm">{presence.roomCode || '—'}</span>
				{#if presence.isInRoom}
					<span class="status status-success status-sm ml-1"></span>
				{:else}
					<span class="status status-warning status-sm ml-1"></span>
				{/if}
			</div>
			<div class="collapse-content space-y-4 pt-0">
				<!-- Device name -->
				<div>
					<p class="label-text mb-1 text-xs opacity-60">Device Name</p>
					{#if editingName}
						<div class="flex gap-2">
							<input
								type="text"
								bind:value={nameInput}
								class="input input-bordered input-sm flex-1"
								placeholder="My Phone"
								onkeydown={(e) => e.key === 'Enter' && saveName()}
							/>
							<button class="btn btn-primary btn-sm" onclick={saveName}>Save</button>
							<button class="btn btn-ghost btn-sm" onclick={() => (editingName = false)}>✕</button>
						</div>
					{:else}
						<div class="flex items-center gap-2">
							<span class="font-semibold">{presence.myName}</span>
							<button
								class="btn btn-ghost btn-xs"
								onclick={() => {
									nameInput = presence.myName;
									editingName = true;
								}}>Edit</button
							>
						</div>
					{/if}
				</div>

				<!-- Room -->
				<div>
					<p class="label-text mb-1 text-xs opacity-60">Room</p>
					{#if editingRoom}
						<div class="flex gap-2">
							<input
								type="text"
								bind:value={roomInput}
								class="input input-bordered input-sm flex-1"
								placeholder="cashier"
								onkeydown={(e) => e.key === 'Enter' && changeRoom()}
							/>
							<button class="btn btn-primary btn-sm" onclick={changeRoom}>Save</button>
							<button
								class="btn btn-ghost btn-sm"
								onclick={() => {
									roomInput = presence.roomCode;
									editingRoom = false;
								}}>✕</button
							>
						</div>
					{:else}
						<div class="flex items-center gap-2">
							<span class="font-mono font-semibold">{presence.roomCode}</span>
							{#if presence.isInRoom}
								<span class="status status-success status-xs"></span>
							{/if}
							<button
								class="btn btn-ghost btn-xs"
								onclick={() => {
									roomInput = presence.roomCode;
									editingRoom = true;
								}}>Edit</button
							>
						</div>
					{/if}
				</div>

				<!-- Device ID -->
				<p class="font-mono text-xs break-all opacity-40">{presence.myId}</p>
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
						<ul class="space-y-2">
							{#each presence.activePeerList as peer (peer.trysteroId)}
								<li class="bg-base-300 rounded-box p-3">
									<div class="flex items-center gap-2">
										<span class="font-semibold flex-1">{peer.name}</span>
										{#if peer.isTrusted}
											<span class="badge badge-success badge-sm">Trusted</span>
											<button
												class="btn btn-primary btn-xs"
												class:btn-outline={syncTargetId !== peer.trysteroId}
												onclick={() =>
													(syncTargetId =
														syncTargetId === peer.trysteroId ? null : peer.trysteroId)}
											>
												{syncTargetId === peer.trysteroId ? 'Selected ✓' : 'Sync from'}
											</button>
										{/if}
									</div>
									{#if !peer.isTrusted}
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
					<h2 class="card-title text-sm">Sync from "{syncTarget.name}"</h2>

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
								bind:checked={includeCashierBean}
							/>
							<span class="flex-1 text-sm">cashier.bean</span>
						</label>
						<label class="flex items-center gap-3 cursor-pointer">
							<input
								type="checkbox"
								class="checkbox checkbox-primary checkbox-sm"
								bind:checked={includeSettings}
							/>
							<span class="flex-1 text-sm">Settings</span>
						</label>
						<label class="flex items-center gap-3 cursor-pointer">
							<input
								type="checkbox"
								class="checkbox checkbox-primary checkbox-sm"
								bind:checked={includeScheduled}
							/>
							<span class="flex-1 text-sm">Scheduled Transactions</span>
						</label>
					</div>

					<a
						href="/sync/beancount?peer={syncTarget.persistentId}"
						class="link link-primary text-xs"
					>
						Need to sync full ledger files instead? Open Beancount Sync →
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
							class="btn btn-sm btn-secondary flex-1"
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
					{#if section.kind === 'text'}
						<DiffViewer
							title={section.filename}
							oldText={section.local}
							newText={section.remote}
							onApplyMerge={applyCashierMerge}
							applyingMerge={applyingCashierMerge}
						/>
					{:else if section.kind === 'settings'}
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
