<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import Notifier from '$lib/utils/notifier';
	import { peerConnection } from '$lib/sync/peerConnection.svelte';

	// Shared singleton. Only its stored identity and trusted list are loaded here; it does not
	// connect, so this works when Peer Sync is not in use.
	const presence = peerConnection.presence;

	onMount(async () => {
		await peerConnection.ensureInit();
		await presence.reloadTrustedPeers();
	});

	function formatDate(iso: string | undefined = undefined): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleString();
	}

	async function setReadOnly(persistentId: string, value: boolean) {
		await presence.setReadOnly(persistentId, value);
		Notifier.info(value ? 'Its data will be ignored' : 'Two-way sync restored');
	}

	async function removeTrust(persistentId: string) {
		await presence.removeTrust(persistentId);
		Notifier.info('Trust removed');
	}
</script>

<main class="flex h-full flex-col">
	<Toolbar title="Trusted Devices" />

	<section class="flex-1 space-y-3 overflow-y-auto touch-pan-y p-4">
		<p class="text-xs opacity-60">
			Peer Sync, WebDAV and S3 merge data only from trusted devices. Devices found in the S3 bucket
			or WebDAV folder are trusted on their sync pages; a read-only device stays on the list but its
			data is ignored.
		</p>

		<div class="card bg-base-200 shadow-sm">
			<div class="card-body gap-2 p-4">
				<h2 class="card-title text-sm">
					Trusted devices
					<span class="badge badge-neutral badge-sm">{presence.trustedPeers.length}</span>
				</h2>
				{#if presence.trustedPeers.length === 0}
					<p class="text-sm opacity-50">
						No trusted devices yet. Trust a device on the Peer Sync, WebDAV or S3 page.
					</p>
				{:else}
					<ul class="divide-base-300 divide-y">
						{#each presence.trustedPeers as tp (tp.id)}
							<li class="flex items-start justify-between gap-2 py-2">
								<div class="min-w-0 flex-1">
									<p class="text-sm font-semibold">
										{tp.name}
										{#if tp.readOnly}<span class="badge badge-neutral badge-sm">read-only</span>{/if}
									</p>
									<p class="font-mono text-xs break-all opacity-40">{tp.id}</p>
									<p class="text-xs opacity-40">
										Trusted: {formatDate(tp.trustedAt)} · Seen: {formatDate(tp.lastSeen)}
									</p>
									<label class="mt-1 flex cursor-pointer items-center gap-2">
										<input
											type="checkbox"
											class="toggle toggle-sm toggle-warning bg-transparent bg-none"
											checked={!!tp.readOnly}
											aria-label="Read-only: ignore data from {tp.name}"
											onchange={(e) => setReadOnly(tp.id, e.currentTarget.checked)}
										/>
										<span class="text-xs opacity-60">Read-only (ignore its data)</span>
									</label>
								</div>
								<button
									class="btn btn-ghost btn-sm text-error shrink-0"
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
