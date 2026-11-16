<script lang="ts">
	import CataloguePicker from '#lib/components/CataloguePicker.svelte';
	import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
	import { onMount } from 'svelte';

	/**
	 * Aware Super settings: the site API key (device-only), then the shared
	 * catalogue picker to download the investment options and choose the active
	 * ones. A selected option is priced for commodities tagged
	 * `AUD:aware/<id>`.
	 */
	let apiKey = $state('');
	let keySaved = $state(false);

	onMount(async () => {
		apiKey = (await deviceSettings.get<string>(DeviceSettingKeys.awareApiKey)) ?? '';
	});

	async function saveKey() {
		apiKey = apiKey.trim();
		await deviceSettings.set(DeviceSettingKeys.awareApiKey, apiKey);
		keySaved = true;
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

	<CataloguePicker providerId="aware" />
	<p class="text-xs opacity-60">
		The id on the right goes in a commodity's <code>price</code> meta, e.g. <code>AUD:aware/42000100</code>.
		Only selected options are priced.
	</p>
</div>
