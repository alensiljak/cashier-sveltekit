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
<div class="bg-base-content/5 m-4 flex aspect-square items-center justify-center">
	<button type="button" class={`btn aspect-square w-20 h-20 flex-col items-center justify-center gap-1.5 rounded-lg ${buttonColour} ${classes}`} {onclick}>
		<span class="text-current">
			<Icon class="w-6 h-6" />
		</span>
		<span class="ml-0! leading-tight">
			{@render children?.()}
		</span>
	</button>
</div>

<!-- <button type="button" class={`btn-icon btn-icon-xl ${buttonColour}`} {onclick}>
        <Icon />
    </button>
    <span>{text}</span> -->
