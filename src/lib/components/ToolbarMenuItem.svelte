<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import type { MouseEventHandler } from 'svelte/elements';

	// Props
	type Props = {
		targetNav?: string;
		text?: string;
		Icon?: Component;
        onclick?: MouseEventHandler<HTMLElement>;
	};
	let { targetNav = '#', text, Icon, onclick } = $props();
</script>

<!--
Example usage:

<ToolbarMenuItem text="Restore Settings" targetNav="/settings" Icon={ArrowBigUpIcon} />
-->

<li>
	<a href={targetNav} class="w-60" onclick={onclick}>
		<span class="flex-auto">{text}</span>
		<span class="badge">
			<!-- {@render icon()} -->
			<Icon />
		</span>
	</a>
</li>
