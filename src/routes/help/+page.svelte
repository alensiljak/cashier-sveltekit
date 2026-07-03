<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { ChevronRightIcon, SearchIcon, XIcon } from '@lucide/svelte';
	import { listHelpTopics } from '$lib/help/helpContent';

	let query = $state('');
	const topics = $derived(listHelpTopics(query));
</script>

<main>
	<Toolbar title="Help"></Toolbar>

	<section class="p-3 pb-0 mx-auto max-w-2xl w-full">
		<label class="input input-bordered flex w-full items-center gap-2">
			<SearchIcon size={16} class="opacity-50" />
			<input type="search" placeholder="Search help…" class="grow" bind:value={query} />
			{#if query}
				<button type="button" aria-label="Clear search" onclick={() => (query = '')}>
					<XIcon size={16} class="opacity-50" />
				</button>
			{/if}
		</label>
	</section>

	<section class="p-1 mx-auto max-w-2xl w-full">
		{#if topics.length}
			<ul class="menu menu-lg w-full">
				{#each topics as { topic, title } (topic)}
					<li>
						<a href="/help/{topic}" class="flex items-center justify-between">
							<span>{title}</span>
							<ChevronRightIcon size={18} class="opacity-50" />
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="p-3 opacity-70">No help topics match "{query}".</p>
		{/if}
	</section>

</main>
