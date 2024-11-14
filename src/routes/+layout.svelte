<script lang="ts">
	import '../app.css';
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Paperclip from 'lucide-svelte/icons/paperclip';
	import Calendar from 'lucide-svelte/icons/calendar';
	import CircleUser from 'lucide-svelte/icons/circle-user';
	import Menu from 'lucide-svelte/icons/menu';
	import Navigation from '../components/navigation.svelte';
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
	<aside class="sticky top-0 col-span-1 h-screen bg-yellow-500 p-4">
		Sidebar

		<!-- <Drawer width="w-[300px]">Cashier</Drawer> -->
		<Navigation />
	</aside>
	<article class="col-span-1">
		<header>
			<!-- Header -->
			<AppBar headlineClasses="sm:hidden" centerClasses="hidden sm:block">
				{#snippet lead()}
					<!-- <ArrowLeft size={24} /> -->
					<Menu size={24} />
				{/snippet}
				{#snippet trail()}
					<Paperclip size={20} />
					<Calendar size={20} />
					<CircleUser size={20} />
				{/snippet}
				{#snippet headline()}
					<h2 class="h2">Headline</h2>
				{/snippet}
				<span>Cashier</span>
			</AppBar>
		</header>
		<!-- Main -->
		<main class="space-y-4 bg-green-500 p-4">
			Main
			<slot></slot>
		</main>
		<!-- Footer -->
		<!-- <footer class="bg-yellow">Footer</footer> -->
	</article>
</div>
