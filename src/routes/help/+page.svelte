<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { ChevronRightIcon } from '@lucide/svelte';
	import { listHelpTopics } from '$lib/help/helpContent';

	const topics = listHelpTopics();
</script>

<article>
	<Toolbar title="Help"></Toolbar>

	<section class="p-1">
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
			<p>No in-app help topics yet.</p>
		{/if}
	</section>

</article>
