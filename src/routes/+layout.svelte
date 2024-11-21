<script lang="ts">
	import { swipe, type SwipeCustomEvent } from 'svelte-gestures';
	import { getDrawerStore } from '@skeletonlabs/skeleton';
	import Navigation from '$lib/navigation.svelte';
	import { page } from '$app/stores';
	import { AppShell, Drawer, initializeStores, Toast } from '@skeletonlabs/skeleton';
	// Stylesheets
	import '../app.css';

	// Reactive Properties
	// $: classesSidebar = $page.url.pathname === '/' ? 'w-0' : 'w-0 lg:w-60';

	initializeStores();
	const drawerStore = getDrawerStore();

	// Default toast duration.
	// setToastDuration(3000);

	function handleSwipe(e: SwipeCustomEvent) {
		if (e.detail.direction == 'right') {
			// alertVisible = true;
			drawerStore.open({ duration: 350 });
		}
		if (e.detail.direction == 'left') {
			// alertVisible = false;
			drawerStore.close();
		}
	}
</script>

<svelte:head>
	<title>Cashier</title>
</svelte:head>

<div use:swipe on:swipe={handleSwipe}>
	<!-- Drawer -->
	<Drawer width="w-72">
		<!-- <h2 class="p-4">Navigation</h2>
	<hr /> -->
		<Navigation />
	</Drawer>
	
	<Toast />

	<AppShell slotSidebarLeft="bg-surface-500/5 w-0 lg:w-72">
		<!-- <svelte:fragment slot="header">
		<Applicationbar />
	</svelte:fragment> -->
		<!-- Left Sidebar Slot -->
		<svelte:fragment slot="sidebarLeft">
			<Navigation />
		</svelte:fragment>
		<!-- Page Route Content -->
		<slot />
	</AppShell>
</div>
