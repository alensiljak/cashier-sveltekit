<script lang="ts">
	/**
	 * Notices of devices that were evicted from the group (by another device, or by this one), until a
	 * person reads them. An eviction is not a data wipe: it only stops this device from merging from,
	 * serving or introducing the evicted device.
	 */
	import type { PeerPresence } from '#lib/sync/peerPresence.svelte';
	import DeviceLabel from '#lib/components/DeviceLabel.svelte';

	let { presence }: { presence: PeerPresence } = $props();
</script>

{#if presence.unseenEvictions.length}
	<div class="card bg-base-200 shadow-sm">
		<div class="card-body gap-3 p-4">
			<h2 class="card-title text-sm">Evicted devices</h2>
			<ul class="flex flex-col gap-2">
				{#each presence.unseenEvictions as e (e.id)}
					<li class="min-w-0">
						{#if e.id === presence.myId}
							<p class="text-warning text-sm">
								{e.byName || 'A device'} evicted <strong>this device</strong> from the group. The others no
								longer sync with it.
							</p>
						{:else}
							<div class="flex min-w-0 items-baseline text-sm">
								<DeviceLabel name={e.name || 'A device'} fingerprint={e.fingerprint} />
							</div>
							<p class="text-xs opacity-60">
								Evicted by {e.byName || 'a device'}. It is no longer trusted here.
							</p>
						{/if}
					</li>
				{/each}
			</ul>
			<div class="card-actions justify-end">
				<button class="btn btn-ghost btn-xs" onclick={() => presence.markEvictionsSeen()}>
					Dismiss
				</button>
			</div>
		</div>
	</div>
{/if}
