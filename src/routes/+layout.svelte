<script lang="ts">
	import '../app.css';
	import Navigation from '$lib/navigation.svelte';
	// import { initializeStores, Drawer } from '@skeletonlabs/skeleton';
	// import { getDrawerStore } from '@skeletonlabs/skeleton';
	import { swipe } from 'svelte-gestures';

	// initializeStores();
	// const drawerStore = getDrawerStore();

	// drawerStore.open();
	// drawerStore.close();

	function handleSwipe() {
		alert('yo!')
	}
</script>

<div class="grid grid-cols-[auto_1fr]">
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
		<div use:swipe={{ timeframe: 300, minSwipeDistance: 60 }} on:swipe={handleSwipe}>Swipe me!</div>
		<slot></slot>
	</article>
</div>
