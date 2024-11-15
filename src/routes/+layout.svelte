<script lang="ts">
	import Navigation from '$lib/navigation.svelte';
	import { page } from '$app/stores';
	import {
		AppShell,
		Drawer,
		initializeStores
	} from '@skeletonlabs/skeleton';
	// Stylesheets
	import '../app.css';

	// Reactive Properties
	$: classesSidebar = $page.url.pathname === '/' ? 'w-0' : 'w-0 lg:w-64';

	initializeStores();
</script>


<!-- sample from the repo -->

 <!-- Drawer -->
<Drawer>
	<h2 class="p-4">Navigation</h2>
	<hr />
	<Navigation />
</Drawer>
<AppShell slotSidebarLeft="bg-surface-500/5 w-0 lg:w-64">
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
