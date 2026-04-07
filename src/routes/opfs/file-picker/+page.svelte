<script lang="ts">
	import OpfsFilePicker from '$lib/components/OpfsFilePicker.svelte';
	import FAB from '$lib/components/FAB.svelte';
	import { Check } from '@lucide/svelte';

	let selectedFile = $state<string | null>(null);
	let checkedFiles = $state<string[]>([]);
	let showCheckboxes = $state(false);

	function toggleCheckboxes() {
		showCheckboxes = !showCheckboxes;
		if (!showCheckboxes) {
			checkedFiles = [];
		}
	}
</script>

<div class="h-screen flex flex-col overflow-hidden">
	<div class="flex-1 overflow-y-auto p-4">
		<OpfsFilePicker bind:selectedFile bind:checkedFiles {showCheckboxes} />
	</div>
</div>

<FAB Icon={Check} onclick={toggleCheckboxes} backgroundColor={showCheckboxes ? 'btn-primary' : 'btn-accent'} />
