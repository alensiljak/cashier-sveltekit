<script lang="ts">
	import { useSwipe, type SwipeCustomEvent } from 'svelte-gestures';
	import Navigation from '$lib/components/navigation.svelte';
	import { fade } from 'svelte/transition';

	let alertVisible: boolean = false;

	function handleSwipe(e: SwipeCustomEvent) {
		if (e.detail.direction == 'right') {
			alertVisible = true;
		}
		if (e.detail.direction == 'left') {
			alertVisible = false;
		}
	}
</script>

<div class="grid grid-cols-[auto_1fr]" {...useSwipe(handleSwipe, () => ({}))}>
	<!-- grid grid-cols-2 md:grid-cols-[auto_1fr] -->
	<!-- Hide the sidebar on small screens; show at the medium breakpoint or wider -->
	<div class="bg-base-300 bg-opacity-5 w-0 lg:w-64">
		<aside class="bg-warning sticky top-0 col-span-1 h-screen p-4">
			<!-- <Drawer width="w-[300px]">Cashier</Drawer> -->
			<Navigation />
		</aside>
	</div>
	<!-- App Shell -->
	<article class="col-span-1">
		<slot></slot>

		{#if alertVisible}
			<aside class="alert alert-neutral border-base-300 border" transition:fade={{ duration: 200 }}>
				<!-- Icon -->
				<div>(icon)</div>
				<!-- Message -->
				<div class="alert-message">
					<h3 class="h3">(title)</h3>
					<p>yo!</p>
				</div>
				<!-- Actions -->
				<div class="alert-actions">(buttons)</div>
			</aside>
		{/if}
	</article>
</div>
