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
<div class="bg-base-content/5 m-4 flex h-32 items-center justify-center">
	<button type="button" class={`btn aspect-square w-20 h-20 flex-col items-center justify-center rounded-lg ${buttonColour} ${classes}`} {onclick}>
		<span class="text-current">
			<Icon class="w-6 h-6 mb-1" />
		</span>
		<span class="mt-1 ml-0!">
			{@render children?.()}
		</span>
	</button>
</div>

<!-- <button type="button" class={`btn-icon btn-icon-xl ${buttonColour}`} {onclick}>
        <Icon />
    </button>
    <span>{text}</span> -->
