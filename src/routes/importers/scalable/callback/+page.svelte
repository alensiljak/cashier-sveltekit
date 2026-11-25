<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import { completeAuthorization } from '#lib/importers/scalable/auth';

	let status = $state<'working' | 'error'>('working');
	let message = $state('');

	onMount(async () => {
		try {
			await completeAuthorization(page.url.searchParams);
			// Tokens are stored; back to the Importers page, where the card now shows as connected.
			await goto('/importers');
		} catch (e) {
			status = 'error';
			message = e instanceof Error ? e.message : String(e);
		}
	});
</script>

<main class="h-screen flex flex-col overflow-hidden">
	<Toolbar title="Scalable Capital" />
	<div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
		{#if status === 'working'}
			<div class="flex items-center gap-2 text-sm opacity-70">
				<span class="loading loading-spinner loading-sm"></span>
				<span>Finishing the Scalable Capital login…</span>
			</div>
		{:else}
			<div class="alert alert-error text-sm">{message}</div>
			<a class="btn btn-primary btn-sm self-start" href="/importers">Back to Importers</a>
		{/if}
	</div>
</main>
