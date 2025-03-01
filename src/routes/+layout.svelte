<script lang="ts">
	// Stylesheets
	import '../app.css';
	// libs
	import { swipe, type SwipeCustomEvent } from 'svelte-gestures';
	import Navigation from '$lib/components/navigation.svelte';
	// Popups
	import { computePosition, autoUpdate, offset, shift, flip, arrow } from '@floating-ui/dom';
	import {
		initializeStores,
		storePopup,
		Toast
	} from '@skeletonlabs/skeleton';
	// PWA
	import { pwaInfo } from 'virtual:pwa-info';
	import { pwaAssetsHead } from 'virtual:pwa-assets/head';
	import { onMount } from 'svelte';
	import { Modal } from '@skeletonlabs/skeleton-svelte';
	import { drawerState } from '$lib/data/mainStore';

	let { children } = $props();

	initializeStores();

	// Reactive Properties
	let webManifest = $derived(pwaInfo ? pwaInfo.webManifest.linkTag : '');

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
			drawerState.update((state) => true);
		}
		if (e.detail.direction == 'left') {
			drawerState.update((state) => false);
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
	<Toast />
	
	<!-- sidebar as modal -->
	<Modal
		bind:open={$drawerState}
		triggerBase="hidden"
		contentBase="bg-surface-500/95 shadow-xl w-[288px] h-screen"
		positionerJustify="justify-start"
		transitionsPositionerIn={{ x: -288, duration: 350 }}
		transitionsPositionerOut={{ x: -288, duration: 350 }}
	>
		{#snippet trigger()}{/snippet}
		{#snippet content()}
			<Navigation />
		{/snippet}
	</Modal>

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
