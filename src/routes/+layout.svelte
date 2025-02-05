<script lang="ts">
	// Stylesheets
	import '../app.css';
	// libs
	import { swipe, type SwipeCustomEvent } from 'svelte-gestures';
	import Navigation from '$lib/components/navigation.svelte';
	// Popups
	import { computePosition, autoUpdate, offset, shift, flip, arrow } from '@floating-ui/dom';
	import {
		Drawer,
		initializeStores,
		Modal,
		getDrawerStore,
		storePopup,
		Toast
	} from '@skeletonlabs/skeleton';
	// PWA
	import { pwaInfo } from 'virtual:pwa-info';
	import { pwaAssetsHead } from 'virtual:pwa-assets/head';
	import { onMount } from 'svelte';

	let { children } = $props();

	initializeStores();

	// Reactive Properties
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

	<!-- PWA -->
	<base href="/" />
	{#each pwaAssetsHead.links as link}
		<link {...link} />
	{/each}
</svelte:head>

<div use:swipe onswipe={handleSwipe}>
	<!-- Drawer -->
	<Drawer width="w-72">
		<Navigation />
	</Drawer>

	<Toast />
	<Modal buttonPositive="variant-filled-primary" />

	<!-- former AppShell -->
	<div class="grid grid-cols-1 lg:grid-cols-[288px_1fr]">
		<aside class="sticky top-0 col-span-1 hidden h-screen bg-surface-500/5 lg:block">
			<Navigation />
		</aside>

		<main class="col-span-1">
			{@render children()}
		</main>
	</div>
</div>

{#await import('$lib/components/ReloadPrompt.svelte') then { default: ReloadPrompt }}
	<ReloadPrompt />
{/await}
