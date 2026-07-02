<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import Notifier from '$lib/utils/notifier';
	import { Check } from '@lucide/svelte';
	import {
		PeerPresence,
		RELAY_STRATEGIES,
		type ActivePeer,
		type RelayStrategy
	} from '$lib/sync/peerPresence.svelte';

	// ─── Presence (identity, room, peers, trust) ───────────────────────────────

	const presence = new PeerPresence();
	let editingName = $state(false);
	let nameInput = $state('');
	let editingRoom = $state(false);
	let roomInput = $state('cashier');
	let configExpanded = $state(true);

	function formatDate(iso: string | undefined = undefined): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleString();
	}

	// ─── Mount ───────────────────────────────────────────────────────────────────

	onMount(async () => {
		await presence.init();
		nameInput = presence.myName;
		roomInput = presence.roomCode;

		// Auto-collapse config if already configured
		if (presence.myName !== 'My Device' && presence.roomCode) configExpanded = false;

		// Auto-join saved (or default) room
		await joinPeerRoom(presence.roomCode);
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
		try {
			await presence.join(code);
			configExpanded = false;
			Notifier.success('Joined room');
		} catch (e) {
			Notifier.error('Failed to join room: ' + (e as Error).message);
		}
	}

	async function leaveRoom() {
		await presence.leave();
		Notifier.info('Left room');
	}

	// ─── Relay strategy ──────────────────────────────────────────────────────────

	/** Switches the signaling network. Reconnects a live room so the new strategy takes effect immediately. */
	async function selectStrategy(value: RelayStrategy) {
		if (presence.strategy === value) return;
		const wasInRoom = presence.isInRoom;
		if (wasInRoom) await leaveRoom();
		await presence.setStrategy(value);
		if (wasInRoom) await joinPeerRoom(presence.roomCode);
	}

	// ─── Trust ───────────────────────────────────────────────────────────────────

	async function trustPeer(peer: ActivePeer) {
		await presence.trust(peer);
		Notifier.success(`Trusted "${peer.name}"`);
	}

	async function removeTrust(persistentId: string) {
		await presence.removeTrust(persistentId);
		Notifier.info('Trust removed');
	}

	onDestroy(() => {
		presence.leave();
	});
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
	<Toolbar title="Peer Sync" {menuItems}>
		{#snippet actions()}
			<HelpButton topic="peer-sync" />
		{/snippet}
	</Toolbar>
	<section class="flex-1 space-y-3 overflow-y-auto p-4">
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
											<a href="/sync/beancount?peer={peer.persistentId}" class="btn btn-primary btn-xs">
												Sync from
											</a>
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
</article>
