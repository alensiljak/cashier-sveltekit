<script lang="ts">
	import OpfsFilePicker from '$lib/components/OpfsFilePicker.svelte';
	import FAB from '$lib/components/FAB.svelte';
	import { Check } from '@lucide/svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	let selectedFile = $state<string | null>(null);
	let checkedFiles = $state<string[]>([]);
	let showCheckboxes = $state(false);

	const returnSetting = $derived(page.url.searchParams.get('returnSetting'));

	function onFabClick() {
		if (returnSetting) {
			if (selectedFile) {
				goto(`/settings?settingKey=${encodeURIComponent(returnSetting)}&settingValue=${encodeURIComponent(selectedFile)}`);
			}
			return;
		}
		showCheckboxes = !showCheckboxes;
		if (!showCheckboxes) {
			checkedFiles = [];
		}
	}
</script>

<div class="h-screen flex flex-col overflow-hidden">
	<div class="flex-1 overflow-y-auto touch-pan-y p-4">
		{#if returnSetting}
			<p class="mb-3 text-sm opacity-70">Select a file for <strong>{returnSetting}</strong>, then tap the confirm button.</p>
		{/if}
		<OpfsFilePicker bind:selectedFile bind:checkedFiles {showCheckboxes} />
	</div>
</div>

<FAB Icon={Check} onclick={onFabClick} backgroundColor={showCheckboxes ? 'btn-primary' : 'btn-accent'} />
