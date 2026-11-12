<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import DeviceLabel from '#lib/components/DeviceLabel.svelte';
	import EvictionNotices from '#lib/components/EvictionNotices.svelte';
	import Notifier from '#lib/utils/notifier';
	import { peerConnection } from '#lib/sync/peerConnection.svelte';
	import { unseenDevices, UNSEEN_WINDOW_MS } from '#lib/sync/lastSeen';

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

	let renaming = $state<string | null>(null);
	let renameText = $state('');

	function startRename(tp: Trusted) {
		renaming = tp.id;
		renameText = tp.name;
	}

	async function saveRename(tp: Trusted) {
		await presence.renamePeer(tp.id, renameText);
		renaming = null;
	}

	let evictDialog = $state<HTMLDialogElement>();
	let evicting = $state<Trusted | null>(null);
	let evictError = $state('');

	let evictCleanUp = $state(true);
	let evictHasBucket = $state(false);
	let evictBusy = $state(false);

	async function startEvict(tp: Trusted) {
		const { loadS3Config, isS3Configured } = await import('#lib/services/s3Config');
		const cfg = await loadS3Config();
		evictHasBucket = isS3Configured(cfg) && !!cfg.passphrase && navigator.onLine;
		evictCleanUp = true;
		evicting = tp;
		evictError = '';
		evictDialog?.showModal();
	}

	async function confirmEvict() {
		if (!evicting) return;
		evictBusy = true;
		try {
			if (evictHasBucket && evictCleanUp) {
				// While it is still trusted: what it uploaded is merged and kept first, then its files go.
				const { loadS3Config } = await import('#lib/services/s3Config');
				const { forgetBucketDevice } = await import('#lib/services/s3Sync');
				await forgetBucketDevice((await loadS3Config())!, evicting.id);
			}
			await presence.evictPeer(evicting.id);
			Notifier.info(`${evicting.name} evicted`);
			evictDialog?.close();
			evicting = null;
		} catch (e) {
			evictError = e instanceof Error ? e.message : String(e);
		} finally {
			evictBusy = false;
		}
	}

	let unseenDialog = $state<HTMLDialogElement>();
	const unseen = $derived(unseenDevices(presence.trustedPeers));

	async function removeUnseen() {
		const ids = unseen.map((p) => p.id);
		for (const id of ids) await presence.removeTrust(id);
		Notifier.info(`Removed ${ids.length} device(s)`);
		unseenDialog?.close();
	}

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

		<EvictionNotices {presence} />

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
									{#if renaming === tp.id}
										<form
											class="flex items-center gap-1"
											onsubmit={(e) => {
												e.preventDefault();
												saveRename(tp);
											}}
										>
											<input
												class="input input-sm input-bordered min-w-0 flex-1"
												aria-label="Name for this device"
												placeholder={tp.announcedName ?? 'Name'}
												bind:value={renameText}
											/>
											<button type="submit" class="btn btn-primary btn-sm">Save</button>
											<button type="button" class="btn btn-ghost btn-sm" onclick={() => (renaming = null)}>
												Cancel
											</button>
										</form>
									{:else}
										<p class="flex items-baseline text-sm font-semibold">
											<DeviceLabel name={tp.name} fingerprint={tp.fingerprint} />
											{#if tp.readOnly}<span class="badge badge-neutral badge-sm ml-2"
													>read-only</span
												>{/if}
										</p>
									{/if}
									{#if tp.announcedName && tp.announcedName !== tp.name}
										<p class="text-xs opacity-60">Calls itself "{tp.announcedName}"</p>
									{/if}
									{#if tp.addedBy}
										{@const introducer = presence.trustedPeers.find(
											(p) => p.id === tp.addedBy || p.legacyIds?.includes(tp.addedBy!)
										)}
										<p class="text-xs opacity-60">
											Trusted on the introduction of {introducer?.name ?? 'a device since removed'}
										</p>
									{/if}
									{#if !tp.publicKey}
										<p class="text-warning text-xs">
											Not verified by a key. Pair it again on the Peer Sync page to use Peer Sync with it.
										</p>
									{/if}
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
								<div class="flex shrink-0 flex-col items-end">
									<button class="btn btn-ghost btn-sm" onclick={() => startRename(tp)}>Rename</button>
									<button class="btn btn-ghost btn-sm text-error" onclick={() => startRemove(tp)}>
										Remove
									</button>
									{#if tp.publicKey}
										<button class="btn btn-ghost btn-sm text-error" onclick={() => startEvict(tp)}>
											Evict
										</button>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
				{#if unseen.length > 0}
					<button class="btn btn-outline btn-sm mt-2" onclick={() => unseenDialog?.showModal()}>
						Remove devices not seen for {UNSEEN_WINDOW_MS / 86400000}+ days ({unseen.length})
					</button>
				{/if}
			</div>
		</div>
	</section>

	<dialog bind:this={unseenDialog} class="modal">
		<div class="modal-box">
			<h3 class="text-lg font-bold">Remove unseen devices?</h3>
			<p class="py-3 text-sm">
				These devices have not been seen for over {UNSEEN_WINDOW_MS / 86400000} days. They are
				removed from this device only; data they uploaded stays in the S3 bucket or WebDAV folder. A
				removed device can be paired again. For a lost or stolen device, use Evict instead.
			</p>
			<ul class="space-y-1 pb-3 text-sm">
				{#each unseen as tp (tp.id)}
					<li class="flex items-baseline justify-between gap-2">
						<DeviceLabel name={tp.name} fingerprint={tp.fingerprint} />
						<span class="text-xs opacity-60">{formatDate(tp.lastSeen || tp.trustedAt)}</span>
					</li>
				{/each}
			</ul>
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={() => unseenDialog?.close()}>Cancel</button>
				<button class="btn btn-error" onclick={removeUnseen}>Remove {unseen.length}</button>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop"><button aria-label="Close">close</button></form>
	</dialog>

	<dialog bind:this={evictDialog} class="modal" onclose={() => (evicting = null)}>
		<div class="modal-box">
			<h3 class="text-lg font-bold">Evict {evicting?.name}?</h3>
			<p class="py-3 text-sm">
				Use this for a lost or stolen device. Every trusted device that hears of it stops trusting
				{evicting?.name}: nothing is merged from it or served to it, and nobody introduces it. A
				device that is offline learns of it when it next connects.
			</p>
			<p class="pb-3 text-sm opacity-70">
				It keeps the data it already has. Change the S3/WebDAV credentials and passphrase as well if
				it holds them. To bring it back, pair with it again on each device.
			</p>
			{#if evictHasBucket}
				<label class="flex cursor-pointer items-start gap-2 pb-3">
					<input type="checkbox" class="checkbox checkbox-sm mt-0.5" bind:checked={evictCleanUp} />
					<span class="text-sm">
						Also delete its data from the S3 bucket. What it uploaded is merged here and kept for the
						other devices first.
					</span>
				</label>
			{/if}
			<p class="pb-3 text-xs opacity-60">
				The eviction is also written to the S3 bucket or WebDAV folder at the next sync, for devices
				that are not online together.
			</p>
			{#if evictError}<p class="text-error text-sm">{evictError}</p>{/if}
			<div class="modal-action">
				<button class="btn btn-ghost" disabled={evictBusy} onclick={() => evictDialog?.close()}>
					Cancel
				</button>
				<button class="btn btn-error" disabled={evictBusy} onclick={confirmEvict}>
					{#if evictBusy}<span class="loading loading-spinner loading-sm"></span>{/if}
					Evict
				</button>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop"><button aria-label="Close">close</button></form>
	</dialog>

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
