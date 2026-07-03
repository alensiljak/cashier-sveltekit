<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import { xact, xactSpan } from '$lib/data/mainStore';
	import ledgerService from '$lib/services/ledgerService';
	import { readFile } from '$lib/utils/opfslib';
	import { CASHIER_XACT_FILE } from '$lib/constants';
	import { locateXactsInSource, findXactAtLine, type XactLocation } from '$lib/utils/xactLocator';
	import { SquarePenIcon } from '@lucide/svelte';

	const path = $derived(decodeURIComponent(page.url.searchParams.get('path') ?? ''));
	const line = $derived(Number(page.url.searchParams.get('line') ?? '0'));

	// Only cashier.bean can be safely edited — it's the one file
	// `ledgerService` reads/writes; other .bean files arrive via `include`
	// and have no in-app write path.
	const isEditable = $derived(path === CASHIER_XACT_FILE);

	let location: XactLocation | undefined = $state(undefined);
	let loaded = $state(false);

	onMount(() => {
		void loadXact();
	});

	$effect(() => {
		// Re-run whenever the query params change (e.g. navigating between
		// two search results without unmounting the page).
		void path;
		void line;
		void loadXact();
	});

	async function loadXact() {
		loaded = false;
		location = undefined;

		if (!path || !line) {
			loaded = true;
			return;
		}

		const source = await readFile(path);
		if (!source) {
			loaded = true;
			return;
		}

		const locations = await locateXactsInSource(source);
		location = findXactAtLine(locations, line);
		loaded = true;
	}

	function onEditClicked() {
		if (!location) return;
		xact.set(location.xact);
		xactSpan.set(location.span);
		goto('/tx');
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Transaction">
		{#snippet actions()}
			<HelpButton topic="transaction-detail" />
		{/snippet}
	</Toolbar>

	<section class="container mx-auto flex-1 overflow-y-auto touch-pan-y p-2 lg:max-w-screen-sm">
		{#if !loaded}
			<div class="flex h-full items-center justify-center">
				<span class="loading loading-spinner loading-lg"></span>
			</div>
		{:else if !location}
			<div class="flex h-32 flex-col items-center justify-center gap-1 opacity-50">
				<p class="text-sm">Transaction not found.</p>
				<p class="font-mono text-xs">{path}:{line}</p>
			</div>
		{:else}
			<p class="px-1 pb-2 font-mono text-xs opacity-50">{path}:{line}</p>
			<div class="border-base-content/15 rounded-lg border p-3">
				<JournalXactRow xact={location.xact} />
			</div>
			{#if isEditable}
				<button class="btn btn-primary btn-sm mt-4" onclick={onEditClicked}>
					<SquarePenIcon size={16} />
					Edit
				</button>
			{:else}
				<p class="px-1 pt-4 text-xs opacity-50">
					Read-only — this file isn't the app's writable transaction store.
				</p>
			{/if}
		{/if}
	</section>
</main>
