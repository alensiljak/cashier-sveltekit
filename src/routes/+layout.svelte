<script lang="ts">
	import '../app.css';
	import Navigation from '$lib/navigation.svelte';
	// import { initializeStores, Drawer } from '@skeletonlabs/skeleton';
	// import { getDrawerStore } from '@skeletonlabs/skeleton';
	import { swipe, type SwipeCustomEvent } from 'svelte-gestures';
	import { fade } from 'svelte/transition';

	// initializeStores();
	// const drawerStore = getDrawerStore();
	let alertVisible: boolean = false;

	// drawerStore.open();
	// drawerStore.close();

	function handleSwipe(e: SwipeCustomEvent) {
		// alert('yo!')
		// console.log(e.detail.direction);
		if(e.detail.direction == 'right') {
			alertVisible = true;
		}
		if(e.detail.direction == 'left') {
			alertVisible = false;
		}
	}
</script>

<div
	class="grid grid-cols-[auto_1fr]"
	use:swipe={{ timeframe: 300, minSwipeDistance: 60 }}
	on:swipe={handleSwipe}
>
	<!-- grid grid-cols-2 md:grid-cols-[auto_1fr] -->
	<!-- Hide the sidebar on small screens; show at the medium breakpoint or wider -->
	<div class="w-0 bg-surface-500/5 lg:w-64">
		<aside class="sticky top-0 col-span-1 h-screen bg-yellow-500 p-4">
			Sidebar

			<!-- <Drawer width="w-[300px]">Cashier</Drawer> -->
			<Navigation />
		</aside>
	</div>
	<article class="col-span-1">
		<slot></slot>

		{#if alertVisible}
			<aside class="alert variant-ghost" transition:fade={{ duration: 200 }}>
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
