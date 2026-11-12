<script lang="ts">
	/**
	 * Devices that a trusted device vouched for. Nothing is trusted until a person taps Trust here:
	 * the introduction is a proposal, and every device decides for itself whom it syncs with.
	 */
	import type { PeerPresence } from '#lib/sync/peerPresence.svelte';
	import DeviceLabel from '#lib/components/DeviceLabel.svelte';

	let { presence }: { presence: PeerPresence } = $props();

	let busy = $state('');
	let error = $state('');

	function introducers(i: { introducedBy: { name: string }[] }): string {
		return i.introducedBy.map((b) => b.name).join(', ');
	}

	async function run(id: string, action: () => Promise<void>) {
		busy = id;
		error = '';
		try {
			await action();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = '';
		}
	}
</script>

{#if presence.pendingIntroductions.length}
	<div class="card bg-base-200 shadow-sm">
		<div class="card-body gap-3 p-4">
			<h2 class="card-title text-sm">Introduced devices</h2>
			<p class="text-xs opacity-70">
				A device you trust vouches for these. Compare the fingerprint with the device itself before
				you trust one. It can only sync once both sides trust each other.
			</p>
			<ul class="flex flex-col gap-2">
				{#each presence.pendingIntroductions as intro (intro.id)}
					<li class="flex items-center gap-2">
						<div class="min-w-0 flex-1">
							<div class="flex min-w-0 items-baseline">
								<DeviceLabel name={intro.name} fingerprint={intro.fingerprint} />
							</div>
							<p class="truncate text-xs opacity-60">Introduced by {introducers(intro)}</p>
						</div>
						<button
							class="btn btn-ghost btn-xs"
							disabled={busy === intro.id}
							onclick={() => run(intro.id, () => presence.dismissIntroduction(intro.id))}
						>
							Dismiss
						</button>
						<button
							class="btn btn-primary btn-xs"
							disabled={busy === intro.id}
							onclick={() => run(intro.id, () => presence.approveIntroduction(intro.id))}
						>
							Trust
						</button>
					</li>
				{/each}
			</ul>
			{#if error}<span class="text-error text-xs">{error}</span>{/if}
		</div>
	</div>
{/if}
