<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { getHelpHtml } from '$lib/help/helpContent';
	import { ArrowLeftIcon } from '@lucide/svelte';

	const topic = page.params.topic ?? '';
	const html = $derived(getHelpHtml(topic));
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Help">
		{#snippet actions()}
			<button
				type="button"
				class="btn btn-ghost btn-circle hover-transparent"
				title="Back to Help index"
				onclick={() => goto('/help')}
			>
				<ArrowLeftIcon size={20} />
			</button>
		{/snippet}
	</Toolbar>

	<section class="p-1">
		{#if html}
			<article class="prose prose-sm max-w-none">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html html}
			</article>
		{:else}
			<p>No help topic found for "{topic}".</p>
		{/if}
	</section>
</main>
