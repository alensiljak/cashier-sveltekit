<script lang="ts">
	/**
	 * "Invite a device": shows the invite link and lists the devices that opened it. Approving one
	 * is what authenticates it, so the name and fingerprint it shows are what to check. A link works
	 * once and expires after ten minutes (see sync/pairing.svelte.ts).
	 */
	import { onDestroy, onMount } from 'svelte';
	import DeviceLabel from '#lib/components/DeviceLabel.svelte';
	import { InviteSession } from '#lib/sync/pairing.svelte';
	import type { PeerPresence } from '#lib/sync/peerPresence.svelte';
	import Notifier from '#lib/utils/notifier';

	let { presence, onclose }: { presence: PeerPresence; onclose: () => void } = $props();

	// svelte-ignore state_referenced_locally
	const session = new InviteSession(presence);
	let now = $state(Date.now());
	let copied = $state(false);
	let busy = $state(false);
	let timer: ReturnType<typeof setInterval> | undefined;

	let secondsLeft = $derived(Math.max(0, Math.ceil((session.expiresAt - now) / 1000)));
	let clock = $derived(
		`${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
	);
	let canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

	onMount(() => {
		timer = setInterval(() => (now = Date.now()), 1000);
		void session.start(location.origin);
	});

	onDestroy(() => {
		clearInterval(timer);
		void session.close();
	});

	async function copy() {
		try {
			await navigator.clipboard.writeText(session.link);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			Notifier.error('Could not copy. Select the link and copy it by hand.');
		}
	}

	async function share() {
		try {
			await navigator.share({ title: 'Cashier invite', url: session.link });
		} catch {
			// Cancelled.
		}
	}

	async function approve(trysteroId: string) {
		busy = true;
		try {
			await session.approve(trysteroId);
			if (session.status === 'approved') Notifier.success(`Paired with "${session.approvedName}"`);
		} catch (e) {
			Notifier.error(e instanceof Error ? e.message : String(e));
		} finally {
			busy = false;
		}
	}
</script>

<div class="modal modal-open">
	<div class="modal-box">
		<h3 class="text-lg font-bold">Invite a device</h3>

		{#if session.status === 'starting' || session.status === 'idle'}
			<p class="py-4 text-sm opacity-70">
				<span class="loading loading-spinner loading-sm"></span> Preparing the invite…
			</p>
		{:else if session.status === 'waiting'}
			<p class="py-2 text-sm opacity-70">
				Send this link to the other device and open it there, or paste it into
				<strong>Paste invite link</strong>. It works once and expires in
				<strong class="font-mono">{clock}</strong>.
			</p>
			<input
				type="text"
				readonly
				class="input input-bordered input-sm w-full font-mono text-xs"
				aria-label="Invite link"
				value={session.link}
				onfocus={(e) => e.currentTarget.select()}
			/>
			<div class="mt-2 flex gap-2">
				<button class="btn btn-sm" onclick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
				{#if canShare}<button class="btn btn-sm" onclick={share}>Share…</button>{/if}
			</div>

			<h4 class="mt-4 text-sm font-semibold">Devices asking to join</h4>
			{#if session.candidates.length === 0}
				<p class="py-2 text-sm opacity-50">
					<span class="loading loading-dots loading-xs"></span> Waiting for a device to open the link…
				</p>
			{:else}
				<ul class="mt-2 space-y-2">
					{#each session.candidates as c (c.trysteroId)}
						<li class="bg-base-200 rounded-box p-3">
							<p class="flex items-baseline text-sm font-semibold">
								<DeviceLabel name={c.name} fingerprint={c.fingerprint} />
							</p>
							{#if c.issue}
								<p class="text-error mt-1 text-xs">
									This device uses a different key than the trusted device with the same ID. It
									cannot be approved.
								</p>
							{:else}
								<p class="mt-1 text-xs opacity-60">
									Approve only if this is the device you invited. Its name can be set by anyone.
								</p>
							{/if}
							<div class="mt-2 flex justify-end gap-2">
								<button class="btn btn-ghost btn-sm" disabled={busy} onclick={() => session.reject(c.trysteroId)}>
									Reject
								</button>
								<button
									class="btn btn-success btn-sm"
									disabled={busy || !!c.issue}
									onclick={() => approve(c.trysteroId)}
								>
									Approve
								</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if session.status === 'approved'}
			<p class="text-success py-4 text-sm">
				"{session.approvedName}" is paired. It will find this device in the private room.
			</p>
		{:else if session.status === 'expired'}
			<p class="py-4 text-sm">This invite has expired. Close this and start a new one.</p>
		{:else if session.status === 'error'}
			<p class="text-error py-4 text-sm">{session.error || 'Could not set up the invite.'}</p>
		{/if}

		<div class="modal-action">
			<button class="btn" onclick={onclose}>
				{session.status === 'waiting' ? 'Cancel' : 'Close'}
			</button>
		</div>
	</div>
	<button class="modal-backdrop" aria-label="Close" onclick={onclose}></button>
</div>
