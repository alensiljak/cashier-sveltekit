<script lang="ts">
	// Stylesheets
	import '../app.css';
	// libs
	import { swipe, type SwipeCustomEvent } from 'svelte-gestures';
	import Navigation from '$lib/navigation.svelte';
	import { page } from '$app/stores';
	// Popups
	import { computePosition, autoUpdate, offset, shift, flip, arrow } from '@floating-ui/dom';
	import {
		AppShell,
		Drawer,
		initializeStores,
		Modal,
		getDrawerStore,
		storePopup,
		Toast,
	} from '@skeletonlabs/skeleton';
	// PWA
	import { pwaInfo } from 'virtual:pwa-info';
	import { pwaAssetsHead } from 'virtual:pwa-assets/head';
	import { onMount } from 'svelte';

	let { children } = $props();

	initializeStores();

	// Reactive Properties
	// $: classesSidebar = $page.url.pathname === '/' ? 'w-0' : 'w-0 lg:w-60';
	// $: webManifest = pwaInfo ? pwaInfo.webManifest.linkTag : ''
	let webManifest = $derived(pwaInfo ? pwaInfo.webManifest.linkTag : '');

	const drawerStore = getDrawerStore();

	// set up popups
	storePopup.set({ computePosition, autoUpdate, offset, shift, flip, arrow });

	onMount(async () => {
		if (pwaInfo) {
			//const { registerSW } = await import('virtual:pwa-register');
			// import { useRegisterSW } from 'virtual:pwa-register/svelte';
			const { useRegisterSW } = await import('virtual:pwa-register/svelte');
			useRegisterSW({
				immediate: true,
				onRegistered(r: any) {
					// uncomment following code if you want check for updates
					// r && setInterval(() => {
					//    console.log('Checking for sw update')
					//    r.update()
					// }, 20000 /* 20s for testing purposes */)
					console.log(`SW Registered: ${r}`);
				},
				onRegisterError(error: any) {
					console.log('SW registration error', error);
				}
			});
		}
	});

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
	{@html webManifest}

	{#if pwaAssetsHead.themeColor}
		<meta name="theme-color" content={pwaAssetsHead.themeColor.content} />
	{/if}
	{#each pwaAssetsHead.links as link}
		<link {...link} />
	{/each}
</svelte:head>

<main use:swipe onswipe={handleSwipe}>
	<!-- Drawer -->
	<Drawer width="w-72">
		<!-- <h2 class="p-4">Navigation</h2>
	<hr /> -->
		<Navigation />
	</Drawer>

	<Toast />
	<Modal buttonPositive="variant-filled-primary" />

	<AppShell slotSidebarLeft="bg-surface-500/5 w-0 lg:w-72">
		<!-- <svelte:fragment slot="header">
			<Applicationbar />
		</svelte:fragment> -->
		<!-- Left Sidebar Slot -->
		<svelte:fragment slot="sidebarLeft">
			<Navigation />
		</svelte:fragment>
		<!-- Page Route Content -->
		<!-- <slot /> -->
		{@render children()}
	</AppShell>
</main>

{#await import('$lib/ReloadPrompt.svelte') then { default: ReloadPrompt }}
	<ReloadPrompt />
{/await}
