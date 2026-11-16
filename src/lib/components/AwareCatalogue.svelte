<script lang="ts">
	import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
	import { getCatalogue, refreshCatalogue, type StoredCatalogue } from '#lib/services/prices/priceCatalogueService';
	import { describeError } from '#lib/services/prices/priceDownloadService';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import { onMount } from 'svelte';

	/**
	 * Aware Super settings: the site API key (device-only) and a manual
	 * download of the investment option list. The list is shown as plain text
	 * (`id  name`); the id is what goes in a commodity's `price` tag:
	 * `AUD:aware/<id>`.
	 */
	const PROVIDER_ID = 'aware';

	let apiKey = $state('');
	let keySaved = $state(false);
	let catalogue = $state<StoredCatalogue | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	const listing = $derived(
		(catalogue?.products ?? []).map((p) => `${p.portId}  ${p.label}`).join('\n')
	);

	onMount(async () => {
		apiKey = (await deviceSettings.get<string>(DeviceSettingKeys.awareApiKey)) ?? '';
		catalogue = await getCatalogue(PROVIDER_ID);
	});

	async function saveKey() {
		apiKey = apiKey.trim();
		await deviceSettings.set(DeviceSettingKeys.awareApiKey, apiKey);
		keySaved = true;
	}

	async function download() {
		loading = true;
		error = null;
		try {
			catalogue = await refreshCatalogue(PROVIDER_ID);
		} catch (e) {
			error = describeError(e);
		}
		loading = false;
	}
</script>

<div class="space-y-4">
	<div class="space-y-1">
		<label class="text-sm font-medium" for="aware-api-key">API key</label>
		<div class="flex gap-2">
			<input
				id="aware-api-key"
				type="password"
				class="input input-bordered input-sm flex-1"
				autocomplete="off"
				placeholder="Sent as X-API-KEY"
				bind:value={apiKey}
				oninput={() => (keySaved = false)}
				onkeydown={(e) => e.key === 'Enter' && void saveKey()}
			/>
			<button type="button" class="btn btn-primary btn-sm rounded" onclick={() => void saveKey()}>
				{keySaved ? 'Saved' : 'Save'}
			</button>
		</div>
		<p class="text-xs opacity-60">Stored on this device only. Copy it from the Aware site's requests.</p>
	</div>

	<div class="flex items-center gap-3">
		<div class="min-w-0 flex-1">
			<p class="text-sm font-medium">Investment options</p>
			<p class="text-xs opacity-60">
				{#if catalogue}
					{catalogue.products.length} options, downloaded {new Date(catalogue.fetchedAt).toLocaleString()}.
				{:else}
					Not downloaded yet.
				{/if}
			</p>
		</div>
		<button
			type="button"
			class="btn btn-primary btn-xs rounded shrink-0"
			disabled={loading || apiKey.trim() === ''}
			onclick={() => void download()}
		>
			{#if loading}<span class="loading loading-spinner loading-xs"></span>{:else}<DownloadIcon
					size={14}
				/>{/if}
			{catalogue ? 'Refresh' : 'Download'}
		</button>
	</div>

	{#if error}
		<div class="alert alert-error text-sm"><span>{error}</span></div>
	{/if}

	{#if catalogue}
		<textarea
			class="textarea textarea-bordered w-full font-mono text-xs"
			rows={Math.min(catalogue.products.length + 1, 20)}
			readonly
			aria-label="Aware investment options"
			value={listing}
		></textarea>
		<p class="text-xs opacity-60">
			Use the id in a commodity's <code>price</code> meta, e.g. <code>AUD:aware/{catalogue.products[0]?.portId}</code>.
		</p>
	{/if}
</div>
