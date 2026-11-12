<script lang="ts">
	/*
	 * Shown on a device that was restored from a backup made on another device, until a person says
	 * whether that device is lost. See services/restoredDevice.ts.
	 */
	import { onMount } from 'svelte';
	import {
		getRestoredDevice,
		markRestoredDeviceInUse,
		markRestoredDeviceLost,
		type RestoredDevice
	} from '#lib/services/restoredDevice';
	import Notifier from '#lib/utils/notifier';

	let restored = $state<RestoredDevice | null>(null);
	let busy = $state(false);

	async function load() {
		restored = await getRestoredDevice();
	}

	onMount(load);

	async function lost() {
		busy = true;
		try {
			await markRestoredDeviceLost();
			Notifier.success(
				'At the next sync, what the old device uploaded is merged here and removed from S3 / WebDAV.'
			);
			await load();
		} finally {
			busy = false;
		}
	}

	async function inUse() {
		busy = true;
		try {
			await markRestoredDeviceInUse();
			Notifier.info('The old device is now an ordinary device. Pair or trust it like any other.');
			await load();
		} finally {
			busy = false;
		}
	}

	/** Lets the page re-read the state after a restore. */
	export function refresh() {
		return load();
	}
</script>

{#if restored}
	<div class="alert alert-warning my-2 flex-col items-start text-sm" role="alert">
		<p class="font-semibold">This device was restored from a backup of another device</p>
		<p>
			What that device uploaded to S3 or WebDAV is read here as this device's own, so nothing it
			saved is missed. Is the old device lost, or does it still exist?
		</p>
		<ul class="list-disc pl-5 opacity-80">
			<li>
				<strong>Lost:</strong> its files are merged here and then removed from the bucket at the next
				sync.
			</li>
			<li>
				<strong>Still in use:</strong> nothing is removed, and the old device is paired and trusted like
				any other device.
			</li>
		</ul>
		<div class="flex gap-2">
			<button type="button" class="btn btn-sm btn-primary" disabled={busy} onclick={lost}>
				It is lost
			</button>
			<button type="button" class="btn btn-sm" disabled={busy} onclick={inUse}>
				It is still in use
			</button>
		</div>
	</div>
{/if}
