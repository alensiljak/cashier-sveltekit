<script lang="ts">
	/**
	 * Opens an invite link (`/pair#<invite>`): joins the inviter's one-use room, waits for the
	 * inviter to approve this device, then joins the inviter's sync group. See sync/pairing.svelte.ts.
	 */
	import { onDestroy, onMount } from 'svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import DeviceLabel from '#lib/components/DeviceLabel.svelte';
	import { deviceIdFromPublicKey, formatFingerprint } from '#lib/sync/deviceKey';
	import { parseInvite, type InvitePayload } from '#lib/sync/invite';
	import { JoinSession } from '#lib/sync/pairing.svelte';
	import { peerConnection } from '#lib/sync/peerConnection.svelte';
	import Notifier from '#lib/utils/notifier';

	const presence = peerConnection.presence;

	let ready = $state(false);
	let problem = $state<'' | 'malformed' | 'unsupported' | 'expired'>('');
	let invite = $state<InvitePayload | null>(null);
	let session = $state<JoinSession | null>(null);
	let myFingerprint = $state('');
	let reconnected = $state(false);

	let replacesGroup = $derived(presence.hasGroup && presence.trustedPeers.length > 0);

	onMount(async () => {
		await peerConnection.ensureInit();
		myFingerprint = formatFingerprint(
			await deviceIdFromPublicKey((await presence.getKey()).publicKey)
		);
		const result = parseInvite(location.hash);
		if (result.ok) invite = result.payload;
		else problem = location.hash.length > 1 ? result.reason : 'malformed';
		ready = true;
	});

	onDestroy(() => {
		void session?.close();
	});

	async function join() {
		if (!invite) return;
		session = new JoinSession(presence, invite);
		await session.start();
	}

	// The group secret has changed: rejoin the room it names.
	$effect(() => {
		if (session?.status !== 'approved' || reconnected) return;
		reconnected = true;
		void (async () => {
			try {
				if (presence.isInRoom) await peerConnection.rescan();
				else await peerConnection.connect();
				Notifier.success(`Paired with "${session?.inviterName}"`);
			} catch (e) {
				Notifier.error('Paired, but could not connect: ' + (e as Error).message);
			}
		})();
	});
</script>

<main class="flex h-full flex-col">
	<Toolbar title="Join a device" />

	<section class="flex-1 space-y-3 overflow-y-auto touch-pan-y p-4">
		{#if !ready}
			<p class="text-sm opacity-60"><span class="loading loading-spinner loading-sm"></span></p>
		{:else if !invite}
			<div class="card bg-base-200 shadow-sm">
				<div class="card-body gap-2 p-4">
					<h2 class="card-title text-sm">
						{problem === 'expired' ? 'This invite has expired' : 'No invite here'}
					</h2>
					<p class="text-sm opacity-70">
						{#if problem === 'expired'}
							An invite works for ten minutes. Ask for a new one.
						{:else if problem === 'unsupported'}
							This invite needs a newer version of Cashier.
						{:else}
							Open an invite link from another device, or paste it on the Peer Sync page.
						{/if}
					</p>
					<a href="/sync/peer" class="btn btn-sm">Go to Peer Sync</a>
				</div>
			</div>
		{:else if !session || session.status === 'idle'}
			<div class="card bg-base-200 shadow-sm">
				<div class="card-body gap-3 p-4">
					<h2 class="card-title text-sm">Join this device to a sync group</h2>
					<p class="flex items-baseline text-sm">
						<span class="opacity-70">Invited by&nbsp;</span>
						<DeviceLabel name={invite.name} fingerprint={formatFingerprint(invite.fingerprint)} />
					</p>
					<p class="text-xs opacity-60">
						The other device will ask you to approve this device by name and fingerprint. Join only
						if you expected this invite.
					</p>
					{#if replacesGroup}
						<p class="text-warning text-xs">
							This device is already paired with other devices. Joining switches it to the sync
							group of "{invite.name}"; the devices paired before will have to be invited again.
						</p>
					{/if}
					<div class="flex gap-2">
						<button class="btn btn-primary btn-sm" onclick={join}>Join</button>
						<a href="/sync/peer" class="btn btn-ghost btn-sm">Cancel</a>
					</div>
				</div>
			</div>
		{:else}
			<div class="card bg-base-200 shadow-sm">
				<div class="card-body gap-2 p-4">
					{#if session.status === 'connecting'}
						<p class="text-sm">
							<span class="loading loading-spinner loading-sm"></span> Looking for "{session.inviterName}"…
						</p>
						<p class="text-xs opacity-60">
							Keep this page open. Both devices need to be online on the same network setting.
						</p>
					{:else if session.status === 'waiting'}
						<p class="text-sm">
							<span class="loading loading-dots loading-sm"></span> Waiting for "{session.inviterName}"
							to approve this device.
						</p>
						<p class="flex items-baseline text-xs opacity-70">
							<span>They will see&nbsp;</span>
							<DeviceLabel name={presence.myName} fingerprint={myFingerprint} />
						</p>
					{:else if session.status === 'approved'}
						<p class="text-success text-sm">
							Paired with "{session.inviterName}". This device now shares its sync group.
						</p>
						<a href="/sync/peer" class="btn btn-primary btn-sm">Open Peer Sync</a>
					{:else if session.status === 'rejected'}
						<p class="text-sm">"{session.inviterName}" did not approve this device.</p>
						<a href="/sync/peer" class="btn btn-sm">Go to Peer Sync</a>
					{:else if session.status === 'expired'}
						<p class="text-sm">The invite expired before it was approved. Ask for a new one.</p>
						<a href="/sync/peer" class="btn btn-sm">Go to Peer Sync</a>
					{:else if session.status === 'error'}
						<p class="text-error text-sm">{session.error || 'Pairing failed.'}</p>
						<a href="/sync/peer" class="btn btn-sm">Go to Peer Sync</a>
					{/if}
				</div>
			</div>
		{/if}
	</section>
</main>
