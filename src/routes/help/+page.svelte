<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { BookTextIcon, ChevronRightIcon } from '@lucide/svelte';
	import { listHelpTopics } from '$lib/help/helpContent';

	const topics = listHelpTopics();

	function openBook() {
		window.open('https://alensiljak.github.io/cashier-book/', '_blank');
	}
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

	<section class="p-1">
		<p>
			For topics not yet covered here, see the full
			<a class="link link-primary" href="https://alensiljak.github.io/cashier-book/">Cashier Book</a>.
		</p>
	</section>
	<section class="p-5 text-center m-5 border border-primary rounded-xl h-50 flex items-center justify-center">
		<button class="btn btn-primary gap-2" onclick={openBook}>
			<BookTextIcon class="w-5 h-5" />
			<span>Open Book</span>
		</button>
	</section>
</article>
