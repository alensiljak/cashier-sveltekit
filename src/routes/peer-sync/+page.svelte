<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { joinRoom } from 'trystero';
	import type { Room, MessageAction } from '@trystero-p2p/core';
	import { buildDiffLines, type DiffSection } from '$lib/utils/diffText';
	import { settings, SettingKeys, deviceSettings, DeviceSettingKeys } from '$lib/settings';
	import db from '$lib/data/db';
	import { readFile, saveFile } from '$lib/utils/opfslib';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import { TrustedPeer, Setting, ScheduledTransaction } from '$lib/data/model';
	import Notifier from '$lib/utils/notifier';
	import { GitCompareArrowsIcon, EyeIcon, DownloadIcon } from '@lucide/svelte';

	// ─── Types ───────────────────────────────────────────────────────────────────

	interface ActivePeer {
		trysteroId: string;
		persistentId: string;
		name: string;
		pairingCode: string;
		isTrusted: boolean;
	}

	interface RemoteData {
		bean: string | null;
		settings: string | null;
		scheduled: string | null;
	}

	type PreviewSection = { filename: string; content: string };

	// Message types for sync protocol
	type SyncRequestMsg = { requestId: string; files: string[] };
	// Index signature required so the type satisfies DataPayload's { [key: string]: JsonValue } branch
	type SyncResponseMsg = {
		requestId: string;
		bean: string | null;
		settings: string | null;
		scheduled: string | null;
		[key: string]: string | null;
	};

	// ─── Identity ────────────────────────────────────────────────────────────────

	let myId = $state('');
	let myName = $state('');
	let editingName = $state(false);
	let nameInput = $state('');

	// ─── Room ────────────────────────────────────────────────────────────────────

	let roomCode = $state('cashier');
	let editingRoom = $state(false);
	let roomInput = $state('cashier');
	let room: Room | null = null;
	let isInRoom = $state(false);
	let configExpanded = $state(true);

	// ─── Peers ───────────────────────────────────────────────────────────────────

	let peersMap = $state<Record<string, ActivePeer>>({});
	let activePeerList = $derived(Object.values(peersMap));
	let trustedPeers = $state<TrustedPeer[]>([]);

	let helloAction: MessageAction<{ id: string; name: string }> | null = null;
	let syncRequestAction: MessageAction<SyncRequestMsg> | null = null;
	let syncResponseAction: MessageAction<SyncResponseMsg> | null = null;
	const pendingRequests = new Map<string, { resolve: (d: RemoteData) => void; reject: (e: Error) => void }>();

	// ─── Sync UI ─────────────────────────────────────────────────────────────────

	let syncTargetId = $state<string | null>(null); // trysteroId of selected peer
	let syncTarget = $derived(syncTargetId ? peersMap[syncTargetId] : null);

	let includeCashierBean = $state(true);
	let includeSettings = $state(false);
	let includeScheduled = $state(false);
	let noneSelected = $derived(!includeCashierBean && !includeSettings && !includeScheduled);
	let allSelected = $derived(includeCashierBean && includeSettings && includeScheduled);
	let indeterminate = $state(false);
	$effect(() => { indeterminate = (includeCashierBean || includeSettings || includeScheduled) && !allSelected; });

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
	let diffSections = $state<DiffSection[]>([]);
	let previewSections = $state<PreviewSection[]>([]);

	// ─── Helpers ─────────────────────────────────────────────────────────────────

	async function computePairingCode(id1: string, id2: string): Promise<string> {
		const combined = [id1, id2].sort().join('|');
		const buffer = new TextEncoder().encode(combined);
		const hash = await crypto.subtle.digest('SHA-256', buffer);
		const view = new DataView(hash);
		return (view.getUint32(0) % 1_000_000).toString().padStart(6, '0');
	}

	async function getLocalData(files: string[]): Promise<RemoteData> {
		return {
			bean: files.includes('bean') ? ((await readFile('cashier.bean')) ?? '') : null,
			settings: files.includes('settings')
				? JSON.stringify(await settings.getAll(), null, 2)
				: null,
			scheduled: files.includes('scheduled')
				? JSON.stringify(await db.scheduled.toArray(), null, 2)
				: null
		};
	}

	function formatDate(iso: string | undefined = undefined): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleString();
	}

	// ─── Mount ───────────────────────────────────────────────────────────────────

	onMount(async () => {
		let id = await deviceSettings.get<string>(DeviceSettingKeys.peerId);
		if (!id) {
			id = crypto.randomUUID();
			await deviceSettings.set(DeviceSettingKeys.peerId, id);
		}
		myId = id;

		const savedName = await deviceSettings.get<string>(DeviceSettingKeys.peerName);
		myName = savedName ?? 'My Device';
		nameInput = myName;

		const savedRoom = await settings.get<string>(SettingKeys.peerRoom);
		if (savedRoom) roomCode = savedRoom;
		roomInput = roomCode;

		trustedPeers = await db.peers.toArray();

		// Auto-collapse config if already configured
		if (myName !== 'My Device' && roomCode) configExpanded = false;

		// Auto-join saved (or default) room
		await joinPeerRoom();
	});

	// ─── Identity ────────────────────────────────────────────────────────────────

	async function saveName() {
		const trimmed = nameInput.trim();
		if (!trimmed) return;
		myName = trimmed;
		await deviceSettings.set(DeviceSettingKeys.peerName, trimmed);
		editingName = false;
		Notifier.success('Name saved');
	}

	// ─── Room ────────────────────────────────────────────────────────────────────

	async function changeRoom() {
		const trimmed = roomInput.trim();
		if (!trimmed || trimmed === roomCode) { editingRoom = false; return; }
		if (isInRoom) await leaveRoom();
		roomCode = trimmed;
		editingRoom = false;
		await joinPeerRoom();
	}

	async function joinPeerRoom() {
		if (!roomCode.trim() || isInRoom) return;

		try {
			room = joinRoom({ appId: 'cashier-peer-sync' }, roomCode.trim());

			helloAction = room.makeAction('hello') as unknown as MessageAction<{ id: string; name: string }>;
			syncRequestAction = room.makeAction('sync-request') as unknown as MessageAction<SyncRequestMsg>;
			syncResponseAction = room.makeAction('sync-response') as unknown as MessageAction<SyncResponseMsg>;

			room.onPeerJoin = (trysteroId) => {
				helloAction!.send({ id: myId, name: myName }, { target: trysteroId });
			};

			helloAction.onMessage = async (data, { peerId: trysteroId }) => {
				const code = await computePairingCode(myId, data.id);
				const isTrusted = trustedPeers.some((p) => p.id === data.id);
				peersMap = {
					...peersMap,
					[trysteroId]: { trysteroId, persistentId: data.id, name: data.name, pairingCode: code, isTrusted }
				};
				if (isTrusted) {
					const tp = trustedPeers.find((p) => p.id === data.id);
					if (tp) { tp.lastSeen = new Date().toISOString(); await db.peers.put(tp); }
				}
			};

			// Respond to sync requests from trusted peers
			syncRequestAction.onMessage = async ({ requestId, files }, { peerId: fromId }) => {
				if (!peersMap[fromId]?.isTrusted) return;
				const data = await getLocalData(files);
				syncResponseAction!.send({ requestId, ...data }, { target: fromId });
			};

			// Resolve pending request promises
			syncResponseAction.onMessage = ({ requestId, bean, settings: s, scheduled }) => {
				const pending = pendingRequests.get(requestId);
				if (pending) {
					pending.resolve({ bean, settings: s, scheduled });
					pendingRequests.delete(requestId);
				}
			};

			room.onPeerLeave = (trysteroId) => {
				const { [trysteroId]: _, ...rest } = peersMap;
				peersMap = rest;
				if (syncTargetId === trysteroId) syncTargetId = null;
			};

			isInRoom = true;
			await settings.set(SettingKeys.peerRoom, roomCode.trim());
			configExpanded = false;
			Notifier.success('Joined room');
		} catch (e) {
			Notifier.error('Failed to join room: ' + (e as Error).message);
		}
	}

	async function leaveRoom() {
		if (room) { await room.leave(); room = null; helloAction = null; syncRequestAction = null; syncResponseAction = null; }
		peersMap = {};
		syncTargetId = null;
		isInRoom = false;
		Notifier.info('Left room');
	}

	// ─── Trust ───────────────────────────────────────────────────────────────────

	async function trustPeer(peer: ActivePeer) {
		const tp = new TrustedPeer();
		tp.id = peer.persistentId;
		tp.name = peer.name;
		tp.trustedAt = new Date().toISOString();
		tp.lastSeen = new Date().toISOString();
		await db.peers.put(tp);
		trustedPeers = await db.peers.toArray();
		peersMap = { ...peersMap, [peer.trysteroId]: { ...peer, isTrusted: true } };
		Notifier.success(`Trusted "${peer.name}"`);
	}

	async function removeTrust(persistentId: string) {
		await db.peers.delete(persistentId);
		trustedPeers = await db.peers.toArray();
		const updated = { ...peersMap };
		for (const [tid, p] of Object.entries(updated)) {
			if (p.persistentId === persistentId) updated[tid] = { ...p, isTrusted: false };
		}
		peersMap = updated;
		if (syncTarget?.persistentId === persistentId) syncTargetId = null;
		Notifier.info('Trust removed');
	}

	// ─── Sync actions ─────────────────────────────────────────────────────────────

	async function fetchRemoteData(files: string[]): Promise<RemoteData> {
		if (!syncTargetId || !syncRequestAction) throw new Error('No peer selected');
		return new Promise((resolve, reject) => {
			const requestId = crypto.randomUUID();
			pendingRequests.set(requestId, { resolve, reject });
			syncRequestAction!.send({ requestId, files }, { target: syncTargetId! });
			setTimeout(() => {
				if (pendingRequests.has(requestId)) {
					pendingRequests.delete(requestId);
					reject(new Error('Request timed out after 30s'));
				}
			}, 30_000);
		});
	}

	async function openPreview() {
		if (!syncTarget || noneSelected) return;
		isFetching = true;
		try {
			const files = selectedFiles();
			const remote = await fetchRemoteData(files);
			const sections: PreviewSection[] = [];
			if (remote.bean !== null) sections.push({ filename: 'cashier.bean', content: remote.bean });
			if (remote.settings !== null) sections.push({ filename: 'settings.json', content: remote.settings });
			if (remote.scheduled !== null) sections.push({ filename: 'scheduled.json', content: remote.scheduled });
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
			const sections: DiffSection[] = [];
			if (remote.bean !== null && local.bean !== null) {
				const lines = buildDiffLines(local.bean, remote.bean);
				sections.push({ filename: 'cashier.bean', lines, identical: lines.every((l) => l.type === 'context') });
			}
			if (remote.settings !== null && local.settings !== null) {
				const lines = buildDiffLines(local.settings, remote.settings);
				sections.push({ filename: 'settings.json', lines, identical: lines.every((l) => l.type === 'context') });
			}
			if (remote.scheduled !== null && local.scheduled !== null) {
				const lines = buildDiffLines(local.scheduled, remote.scheduled);
				sections.push({ filename: 'scheduled.json', lines, identical: lines.every((l) => l.type === 'context') });
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

	onDestroy(() => {
		room?.leave();
	});
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Peer Sync">
		{#snippet actions()}
			<HelpButton topic="peer-sync" />
		{/snippet}
	</Toolbar>
	<section class="flex-1 space-y-3 overflow-y-auto p-4">

		<!-- Config collapse -->
		<div class="collapse collapse-arrow bg-base-200 rounded-box">
			<input type="checkbox" bind:checked={configExpanded} />
			<div class="collapse-title flex items-center gap-2 py-2 pr-10 font-medium">
				<span class="font-semibold">{myName || '…'}</span>
				<span class="text-base-content/40">·</span>
				<span class="font-mono text-sm">{roomCode || '—'}</span>
				{#if isInRoom}
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
							<span class="font-semibold">{myName}</span>
							<button class="btn btn-ghost btn-xs" onclick={() => { nameInput = myName; editingName = true; }}>Edit</button>
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
							<button class="btn btn-ghost btn-sm" onclick={() => { roomInput = roomCode; editingRoom = false; }}>✕</button>
						</div>
					{:else}
						<div class="flex items-center gap-2">
							<span class="font-mono font-semibold">{roomCode}</span>
							{#if isInRoom}
								<span class="status status-success status-xs"></span>
							{/if}
							<button class="btn btn-ghost btn-xs" onclick={() => { roomInput = roomCode; editingRoom = true; }}>Edit</button>
						</div>
					{/if}
				</div>

				<!-- Device ID -->
				<p class="font-mono text-xs break-all opacity-40">{myId}</p>
			</div>
		</div>

		<!-- Active Peers in Room -->
		{#if isInRoom}
			<div class="card bg-base-200 shadow-sm">
				<div class="card-body p-4">
					<h2 class="card-title text-sm">
						Peers in Room
						<span class="badge badge-neutral badge-sm">{activePeerList.length}</span>
					</h2>

					{#if activePeerList.length === 0}
						<p class="text-sm opacity-50">Waiting for other devices…</p>
					{:else}
						<ul class="space-y-2">
							{#each activePeerList as peer (peer.trysteroId)}
								<li class="bg-base-300 rounded-box p-3">
									<div class="flex items-center gap-2">
										<span class="font-semibold flex-1">{peer.name}</span>
										{#if peer.isTrusted}
											<span class="badge badge-success badge-sm">Trusted</span>
											<button
												class="btn btn-primary btn-xs"
												class:btn-outline={syncTargetId !== peer.trysteroId}
												onclick={() => syncTargetId = syncTargetId === peer.trysteroId ? null : peer.trysteroId}
											>
												{syncTargetId === peer.trysteroId ? 'Selected ✓' : 'Sync from'}
											</button>
										{/if}
									</div>
									{#if !peer.isTrusted}
										<div class="mt-2 rounded bg-warning/15 p-2 text-sm">
											<p class="text-xs font-medium opacity-70">Confirm pairing code on both devices:</p>
											<p class="font-mono text-2xl font-bold tracking-[0.25em]">{peer.pairingCode}</p>
										</div>
										<button class="btn btn-success btn-sm mt-2 w-full" onclick={() => trustPeer(peer)}>
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
							<input type="checkbox" class="checkbox checkbox-primary checkbox-sm"
								checked={allSelected} bind:indeterminate={indeterminate} onclick={toggleSelectAll} />
							<span class="text-xs opacity-60">Select all</span>
						</label>
						<div class="divider my-0"></div>
						<label class="flex items-center gap-3 cursor-pointer">
							<input type="checkbox" class="checkbox checkbox-primary checkbox-sm" bind:checked={includeCashierBean} />
							<span class="flex-1 text-sm">cashier.bean</span>
						</label>
						<label class="flex items-center gap-3 cursor-pointer">
							<input type="checkbox" class="checkbox checkbox-primary checkbox-sm" bind:checked={includeSettings} />
							<span class="flex-1 text-sm">Settings</span>
						</label>
						<label class="flex items-center gap-3 cursor-pointer">
							<input type="checkbox" class="checkbox checkbox-primary checkbox-sm" bind:checked={includeScheduled} />
							<span class="flex-1 text-sm">Scheduled Transactions</span>
						</label>
					</div>

					<div class="flex gap-2 flex-wrap pt-1">
						<button class="btn btn-sm btn-outline flex-1" disabled={noneSelected || isFetching} onclick={openPreview}>
							{#if isFetching}<span class="loading loading-spinner loading-xs"></span>{:else}<EyeIcon size={14} />{/if}
							Preview
						</button>
						<button class="btn btn-sm btn-secondary flex-1" disabled={noneSelected || isFetching} onclick={openDiff}>
							{#if isFetching}<span class="loading loading-spinner loading-xs"></span>{:else}<GitCompareArrowsIcon size={14} />{/if}
							Diff
						</button>
						<button class="btn btn-sm btn-primary flex-1" disabled={noneSelected || isPulling} onclick={() => showPullConfirm = true}>
							{#if isPulling}<span class="loading loading-spinner loading-xs"></span>{:else}<DownloadIcon size={14} />{/if}
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
				<span class="badge badge-neutral badge-sm ml-1">{trustedPeers.length}</span>
			</div>
			<div class="collapse-content pt-0">
				{#if trustedPeers.length === 0}
					<p class="text-sm opacity-50">No trusted devices yet.</p>
				{:else}
					<ul class="divide-base-300 divide-y">
						{#each trustedPeers as tp (tp.id)}
							<li class="flex items-start justify-between gap-2 py-2">
								<div class="min-w-0 flex-1">
									<p class="font-semibold text-sm">{tp.name}</p>
									<p class="font-mono text-xs opacity-40 break-all">{tp.id}</p>
									<p class="text-xs opacity-40">
										Trusted: {formatDate(tp.trustedAt)} · Seen: {formatDate(tp.lastSeen)}
									</p>
								</div>
								<button class="btn btn-ghost btn-xs text-error shrink-0" onclick={() => removeTrust(tp.id)}>
									Remove
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>

	</section>
</article>

<!-- ─── Preview Modal ──────────────────────────────────────────────────────── -->
{#if showPreview}
	<div class="modal modal-open">
		<div class="modal-box h-[90vh] max-w-3xl flex flex-col p-0">
			<div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
				<h3 class="font-bold">Preview — {syncTarget?.name}</h3>
				<button class="btn btn-ghost btn-sm" onclick={() => showPreview = false}>✕</button>
			</div>
			<div class="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
				{#each previewSections as section}
					<div>
						<p class="font-mono text-sm font-semibold mb-1 opacity-60">{section.filename}</p>
						<pre class="text-xs font-mono leading-5 overflow-x-auto rounded bg-base-200 p-2 select-text whitespace-pre">{section.content}</pre>
					</div>
				{/each}
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => showPreview = false}></button>
	</div>
{/if}

<!-- ─── Diff Modal ─────────────────────────────────────────────────────────── -->
{#if showDiff}
	<div class="modal modal-open">
		<div class="modal-box h-[90vh] max-w-3xl flex flex-col p-0">
			<div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
				<h3 class="font-bold">Diff — Local vs {syncTarget?.name}</h3>
				<button class="btn btn-ghost btn-sm" onclick={() => showDiff = false}>✕</button>
			</div>
			<div class="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
				<div class="flex gap-4 text-xs opacity-50">
					<span class="flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-sm bg-success/40"></span>incoming (peer only)</span>
					<span class="flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-sm bg-error/40"></span>will be removed (local only)</span>
				</div>
				{#each diffSections as section}
					<div>
						<p class="font-mono text-sm font-semibold mb-1 opacity-60">{section.filename}</p>
						{#if section.identical}
							<p class="text-sm text-success">Files are identical.</p>
						{:else}
							<pre class="text-xs font-mono leading-5 overflow-x-auto rounded bg-base-200 p-2 select-text">{#each section.lines as line}{#if line.type === 'removed'}<span class="block bg-error/20 text-error-content whitespace-pre">- {line.content}</span>{:else if line.type === 'added'}<span class="block bg-success/20 text-success-content whitespace-pre">+ {line.content}</span>{:else}<span class="block opacity-50 whitespace-pre">  {line.content}</span>{/if}{/each}</pre>
						{/if}
					</div>
				{/each}
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => showDiff = false}></button>
	</div>
{/if}

<!-- ─── Pull Confirm ───────────────────────────────────────────────────────── -->
{#if showPullConfirm}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">Confirm Pull</h3>
			<p class="py-4 text-sm">
				Overwrite local data with the version from <strong>{syncTarget?.name}</strong>?
				This cannot be undone.
			</p>
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={() => showPullConfirm = false}>Cancel</button>
				<button class="btn btn-warning" onclick={confirmPull}>Overwrite</button>
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => showPullConfirm = false}></button>
	</div>
{/if}
