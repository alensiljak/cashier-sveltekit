<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import Notifier from '#lib/utils/notifier';
	import { peerConnection } from '#lib/sync/peerConnection.svelte';

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

	type Trusted = (typeof presence.trustedPeers)[number];

	let removeDialog = $state<HTMLDialogElement>();
	let removing = $state<Trusted | null>(null);
	let cleanUp = $state(true);
	let busy = $state(false);
	let failure = $state('');

	/** Removes the trust at once, or asks first when the device may have left data in the S3 bucket. */
	async function startRemove(tp: Trusted) {
		const { loadS3Config, isS3Configured } = await import('#lib/services/s3Config');
		const cfg = await loadS3Config();
		if (!isS3Configured(cfg) || !cfg.passphrase || !navigator.onLine) {
			await removeTrust(tp.id);
			return;
		}
		removing = tp;
		cleanUp = true;
		failure = '';
		removeDialog?.showModal();
	}

	async function removeTrust(persistentId: string) {
		await presence.removeTrust(persistentId);
		Notifier.info('Trust removed');
	}

	async function confirmRemove() {
		if (!removing) return;
		busy = true;
		failure = '';
		try {
			if (cleanUp) {
				const { loadS3Config } = await import('#lib/services/s3Config');
				const { forgetBucketDevice } = await import('#lib/services/s3Sync');
				const { deleted } = await forgetBucketDevice((await loadS3Config())!, removing.id);
				Notifier.info(`Removed ${deleted} object(s) of the device from the bucket`);
			}
			await removeTrust(removing.id);
			removeDialog?.close();
			removing = null;
		} catch (e) {
			// The device is still trusted, so its data can be merged once the problem is fixed.
			failure = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function removeWithoutCleanUp() {
		if (!removing) return;
		await removeTrust(removing.id);
		removeDialog?.close();
		removing = null;
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
									onclick={() => startRemove(tp)}
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

	<dialog bind:this={removeDialog} class="modal" onclose={() => (removing = null)}>
		<div class="modal-box">
			<h3 class="text-lg font-bold">Remove {removing?.name}?</h3>
			<p class="py-3 text-sm">
				Its data will no longer be merged on this device. The S3 bucket may still hold what it
				uploaded.
			</p>
			<label class="flex cursor-pointer items-start gap-2">
				<input type="checkbox" class="checkbox checkbox-sm mt-0.5" bind:checked={cleanUp} />
				<span class="text-sm">
					Also delete its data from the S3 bucket. What it uploaded is merged here and kept for the
					other devices first; its own files and manifest are then deleted.
				</span>
			</label>
			{#if failure}
				<p class="text-error mt-3 text-sm">{failure}</p>
			{/if}
			<div class="modal-action">
				<button class="btn btn-ghost" disabled={busy} onclick={() => removeDialog?.close()}>
					Cancel
				</button>
				{#if failure}
					<button class="btn btn-warning" disabled={busy} onclick={removeWithoutCleanUp}>
						Remove anyway
					</button>
				{/if}
				<button class="btn btn-error" disabled={busy} onclick={confirmRemove}>
					{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
					Remove
				</button>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop"><button aria-label="Close">close</button></form>
	</dialog>
</main>
