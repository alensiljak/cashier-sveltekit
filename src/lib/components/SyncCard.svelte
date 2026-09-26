<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { RefreshCwIcon, UsersIcon } from '@lucide/svelte';
	import CashierCardTemplate from './CashierCardTemplate.svelte';
	import { peerConnection } from '$lib/sync/peerConnection.svelte';
	import { reloadLedgerFromOpfs } from '$lib/services/ledgerReload';
	import Notifier from '$lib/utils/notifier';

	const presence = peerConnection.presence;

	let connecting = $state(false);
	let syncing = $state(false);

	let trustedPeers = $derived(presence.activePeerList.filter((p) => p.isTrusted));

	/** Per-peer comparison of Local Transactions, done as soon as a trusted peer appears. */
	type DiffState = 'checking' | 'same' | 'differs' | 'unknown';
	let diffs = $state<Record<string, DiffState>>({});

	async function checkPeer(id: string) {
		diffs[id] = 'checking';
		try {
			const [local, remote] = await Promise.all([
				peerConnection.getLocalYdocHash(),
				peerConnection.fetchRemoteYdocHash(id)
			]);
			diffs[id] =
				local === null || remote === null ? 'unknown' : local === remote ? 'same' : 'differs';
		} catch {
			diffs[id] = 'unknown';
		}
	}

	$effect(() => {
		const ids = trustedPeers.map((p) => p.trysteroId);
		untrack(() => {
			for (const id of ids) if (!(id in diffs)) void checkPeer(id);
			for (const id of Object.keys(diffs)) if (!ids.includes(id)) delete diffs[id];
		});
	});

	onMount(() => peerConnection.ensureInit());

	async function toggleConnection() {
		connecting = true;
		try {
			if (presence.isInRoom) {
				await peerConnection.disconnect();
			} else {
				await peerConnection.connect();
			}
		} catch (e) {
			Notifier.error('Connection failed: ' + (e as Error).message);
		} finally {
			connecting = false;
		}
	}

	/** Merges Local Transactions with every trusted peer that is currently online. */
	async function onSync() {
		if (syncing || trustedPeers.length === 0) return;
		syncing = true;
		try {
			if ((await peerConnection.getLocalYdocHash()) === null) {
				// Not the CRDT store — the remaining items need the review screens.
				await goto('/peer-sync');
				return;
			}
			let changed = false;
			for (const peer of trustedPeers) {
				changed = (await peerConnection.syncYdoc(peer.trysteroId)) || changed;
			}
			await Promise.all(trustedPeers.map((p) => checkPeer(p.trysteroId)));
			if (changed) await reloadLedgerFromOpfs();
			Notifier.success(changed ? 'Synced — new transactions received' : 'Already in sync');
		} catch (e) {
			Notifier.error('Sync failed: ' + (e as Error).message);
		} finally {
			syncing = false;
		}
	}
</script>

<CashierCardTemplate onclick={() => goto('/peer-sync')}>
	{#snippet icon()}
		<UsersIcon />
	{/snippet}
	{#snippet title()}
		Sync
	{/snippet}
	{#snippet content()}
		<div class="flex items-start gap-3">
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span class="shrink-0" onclick={(e) => e.stopPropagation()}>
				{#if connecting}
					<span class="loading loading-spinner loading-sm"></span>
				{:else}
					<input
						type="checkbox"
						class="toggle toggle-success bg-transparent bg-none"
						checked={presence.isInRoom}
						aria-label={presence.isInRoom ? 'Disconnect peer sync' : 'Connect peer sync'}
						onchange={toggleConnection}
					/>
				{/if}
			</span>
			<div class="grow min-w-0">
				{#if !presence.isInRoom}
					<p class="text-sm opacity-60">Peer sync is off.</p>
				{:else if presence.activePeerList.length === 0}
					<p class="text-sm opacity-60">Looking for other devices…</p>
				{:else}
					<ul class="space-y-1 text-base">
						{#each presence.activePeerList as peer (peer.trysteroId)}
							<li class="flex items-center gap-2">
								<span class="grow truncate">{peer.name}</span>
								{#if !peer.isTrusted}
									<span class="badge badge-ghost badge-sm">Not paired</span>
								{:else if diffs[peer.trysteroId] === 'checking'}
									<span class="loading loading-spinner loading-xs"></span>
								{:else if diffs[peer.trysteroId] === 'same'}
									<span class="badge badge-success badge-sm">In sync</span>
								{:else if diffs[peer.trysteroId] === 'differs'}
									<span class="badge badge-warning badge-sm">Changes</span>
								{:else}
									<span class="badge badge-success badge-sm">Trusted</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	{/snippet}
	{#snippet footer()}
		<center>
			<button
				type="button"
				class="btn btn-outline btn-warning uppercase"
				disabled={syncing ||
					!presence.isInRoom ||
					trustedPeers.length === 0 ||
					trustedPeers.every((p) => diffs[p.trysteroId] === 'same')}
				onclick={(e) => {
					e.stopPropagation();
					onSync();
				}}
			>
				{#if syncing}
					<span class="loading loading-spinner loading-xs"></span>
				{:else}
					<RefreshCwIcon />
				{/if}
				<span>Sync</span>
			</button>
		</center>
	{/snippet}
</CashierCardTemplate>
