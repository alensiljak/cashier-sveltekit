<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import { xact, xactId } from '$lib/data/mainStore';
	import { getXactStore } from '$lib/storage/xactStoreRegistry';
	import { readFile } from '$lib/utils/opfslib';
	import { locateXactsInSource, findXactAtLine } from '$lib/utils/xactLocator';
	import type { XactId } from '$lib/storage/xactStore';
	import type { Xact } from '$lib/data/model';
	import { SquarePenIcon } from '@lucide/svelte';

	// Two ways in:
	//  - `id`: a working-set transaction (from the active store) — editable.
	//  - `path` + `line`: a text-search hit in a .bean file — read-only, since
	//    those files arrive via `include` and have no in-app write path.
	const id = $derived(page.url.searchParams.get('id') ?? '');
	const path = $derived(decodeURIComponent(page.url.searchParams.get('path') ?? ''));
	const line = $derived(Number(page.url.searchParams.get('line') ?? '0'));

	const isEditable = $derived(id !== '');

	let found: { xact: Xact; id?: XactId } | undefined = $state(undefined);
	let loaded = $state(false);

	onMount(() => {
		void loadXact();
	});

	$effect(() => {
		// Re-run whenever the query params change (e.g. navigating between
		// two search results without unmounting the page).
		void id;
		void path;
		void line;
		void loadXact();
	});

	async function loadXact() {
		loaded = false;
		found = undefined;

		if (id) {
			const stored = (await (await getXactStore()).list()).find((s) => s.id === id);
			found = stored && { xact: stored.xact, id: stored.id };
			loaded = true;
			return;
		}

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
		const location = findXactAtLine(locations, line);
		found = location && { xact: location.xact };
		loaded = true;
	}

	function onEditClicked() {
		if (!found || found.id === undefined) return;
		xact.set(found.xact);
		xactId.set(found.id);
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
		{:else if !found}
			<div class="flex h-32 flex-col items-center justify-center gap-1 opacity-50">
				<p class="text-sm">Transaction not found.</p>
				<p class="font-mono text-xs">{id || `${path}:${line}`}</p>
			</div>
		{:else}
			{#if !id}
				<p class="px-1 pb-2 font-mono text-xs opacity-50">{path}:{line}</p>
			{/if}
			<div class="border-base-content/15 rounded-lg border p-3">
				<JournalXactRow xact={found.xact} />
			</div>
			{#if isEditable}
				<button class="btn btn-primary btn-sm mt-4" onclick={onEditClicked}>
					<SquarePenIcon size={16} />
					Edit
				</button>
			{:else}
				<p class="px-1 pt-4 text-xs opacity-50">
					Read-only — edit transactions from the Device Journal.
				</p>
			{/if}
		{/if}
	</section>
</main>
