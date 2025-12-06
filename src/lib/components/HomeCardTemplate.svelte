<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { EventHandler } from 'svelte/elements';

	type Props = {
		icon?: Snippet;
		title?: Snippet;
		menu?: Snippet;
		header?: Snippet;
		content?: Snippet;
		footer?: Snippet;
		onclick?: EventHandler;
	};
	let { icon, title, menu, header, content, footer, onclick }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<article class="card bg-base-200 rounded-lg" {onclick} role="list">
	<header class="card-header bg-primary flex rounded-t-lg px-3 py-2">
		{#if header}{@render header()}{/if}
		{#if icon}{@render icon()}{/if}
		<span class="grow pl-3">
			{#if title}{@render title()}{/if}
		</span>
		{#if menu}
			{@render menu()}
		{/if}
	</header>
	<section class="px-1 py-2">
		{#if content}{@render content()}{/if}
	</section>
	{#if footer}
		<footer class="card-footer">
			{@render footer()}
		</footer>
	{/if}
</article>
