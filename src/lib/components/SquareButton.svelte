<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { EventHandler } from 'svelte/elements';

	interface Props {
		Icon?: any;
		// text?: string;
        // textColour?: string;
		// bgColour?: string;
        classes: string;
		onclick?: EventHandler;
        children: Snippet
	}
	let { Icon, classes, onclick, children }: Props = $props();
    // colour = 'primary',

	// let buttonColour = $derived(colour ? 'variant-filled-' + colour : '');
</script>

<!-- flex-col text-center -->
<div class="m-4 flex h-32 items-center justify-center bg-surface-600/50">
	<button type="button" class={`btn flex flex-col w-20 aspect-square ${classes}`} {onclick}>
        <Icon />
        <span class="mt-1 !ml-0">
        {@render children?.()}
    </span>
	</button>
</div>

<!-- <button type="button" class={`btn-icon btn-icon-xl ${buttonColour}`} {onclick}>
        <Icon />
    </button>
    <span>{text}</span> -->
