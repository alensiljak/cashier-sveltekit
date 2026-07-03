<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import Fab from '$lib/components/FAB.svelte';
	import { settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import { Check, CircleAlert, CircleCheck } from '@lucide/svelte';

	Notifier.init();

	let jsonText = $state('');
	let isValid = $derived(isJsonValid(jsonText));

	function isJsonValid(text: string): boolean {
		if (!text.trim()) return false;
		try {
			JSON.parse(text);
			return true;
		} catch {
			return false;
		}
	}

	onMount(async () => {
		const rows = await settings.getAll();
		const obj: Record<string, unknown> = {};
		for (const row of rows) {
			try {
				obj[row.key] = JSON.parse(row.value);
			} catch {
				obj[row.key] = row.value;
			}
		}
		jsonText = JSON.stringify(obj, null, 2);
	});

	async function save() {
		if (!isValid) return;
		const obj = JSON.parse(jsonText) as Record<string, unknown>;
		for (const [key, value] of Object.entries(obj)) {
			await settings.set(key, value);
		}
		Notifier.success('Settings saved');
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Settings JSON Editor" />

	<div class="flex items-center gap-2 px-3 py-2">
		{#if isValid}
			<CircleCheck size={20} class="text-success" />
			<span class="text-sm text-success">Valid JSON</span>
		{:else}
			<CircleAlert size={20} class="text-error" />
			<span class="text-sm text-error">Invalid JSON</span>
		{/if}
	</div>

	<textarea
		class="font-mono text-sm w-full resize-none p-3 outline-none bg-base-100 text-base-content flex-1"
		spellcheck="false"
		bind:value={jsonText}
	></textarea>

	<Fab Icon={Check} onclick={save} />
</main>
