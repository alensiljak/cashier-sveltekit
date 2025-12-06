<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { EventHandler } from 'svelte/elements';

	interface Props {
		Icon?: any;
		colour?: string;
		// text?: string;
		// textColour?: string;
		// bgColour?: string;
		classes: string;
		onclick?: EventHandler;
		children: Snippet;
	}
	let { Icon, colour, classes, onclick, children }: Props = $props();
	// colour = 'primary',

	let buttonColour = $derived(colour ? 'btn-' + colour : '');
</script>

<!-- flex-col text-center -->
<div class="bg-surface-600/50 m-4 flex h-32 items-center justify-center">
	<button type="button" class={`btn flex aspect-square w-20 flex-col ${buttonColour} ${classes}`} {onclick}>
		<Icon />
		<span class="mt-1 ml-0!">
			{@render children?.()}
		</span>
	</button>
</div>

<!-- <button type="button" class={`btn-icon btn-icon-xl ${buttonColour}`} {onclick}>
        <Icon />
    </button>
    <span>{text}</span> -->
