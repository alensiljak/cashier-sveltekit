<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	// Props
	type Props = {
		targetNav?: string;
		text?: string;
		Icon?: Component;
	};
	let { targetNav = '/', text, Icon } = $props();
</script>

<li>
	<a href={targetNav}>
		<span class="flex-auto">{text}</span>
		<span class="badge">
			<!-- {@render icon()} -->
			<Icon />
		</span>
	</a>
</li>
