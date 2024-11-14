<script lang="ts">
	import '../app.css'
	import Navigation from '$lib/navigation.svelte'
	// import { initializeStores, Drawer } from '@skeletonlabs/skeleton';
	// import { getDrawerStore } from '@skeletonlabs/skeleton';

	// initializeStores();
	// const drawerStore = getDrawerStore();

	// drawerStore.open();
	// drawerStore.close();
</script>

<div class="grid grid-cols-[auto_1fr]">
	<!-- grid grid-cols-2 md:grid-cols-[auto_1fr] -->
	<!-- Hide the sidebar on small screens; show at the medium breakpoint or wider -->
	 <div class="bg-surface-500/5 w-0 lg:w-64">
	<aside class="sticky top-0 col-span-1 h-screen bg-yellow-500 p-4">
		Sidebar

		<!-- <Drawer width="w-[300px]">Cashier</Drawer> -->
		<Navigation />
	</aside>
</div>
	<article class="col-span-1">

		<slot></slot>
	</article>
</div>
