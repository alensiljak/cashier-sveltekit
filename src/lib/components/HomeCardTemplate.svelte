<script lang="ts">
	import { StarIcon } from 'lucide-svelte';
	import type { Snippet } from 'svelte';

	type Props = {
        icon?: Snippet
        title?: Snippet
		header?: Snippet
		content?: Snippet
		footer?: Snippet
	};
    let { icon, title, header, content, footer }: Props = $props();
</script>

<div class="card rounded-lg">
	<header class="card-header flex rounded-t-lg bg-primary-500 px-3 py-2">
        {#if header}{@render header()}{/if}
        {#if icon}{@render icon()}{/if}
		<span class="pl-3">
            {#if title}{@render title()}{/if}
		</span>
	</header>
	<section class="p-4">
        {#if content}{@render content()}{/if}
	</section>
    {#if footer}
	<footer class="card-footer">
        {@render footer()}
	</footer>
    {/if}
</div>
