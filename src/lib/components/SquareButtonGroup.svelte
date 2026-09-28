<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Extra classes for the outer wrapper, e.g. top spacing (defaults to pt-10). */
		class?: string;
		children: Snippet;
	}
	let { class: classes = 'pt-10', children }: Props = $props();
</script>

<div class={`mx-auto flex max-w-[390px] flex-wrap justify-center gap-6 px-8 sm:gap-16 sm:px-0 ${classes}`}>
	{@render children()}
</div>
