<script lang="ts">
	// Stylesheets
	import '../app.css';
	// libs
	import { useSwipe, type SwipeCustomEvent } from 'svelte-gestures';
	// import Navigation from '$lib/components/navigation.svelte';
	// PWA
	import { pwaInfo } from 'virtual:pwa-info';
	import { pwaAssetsHead } from 'virtual:pwa-assets/head';
	import { onMount } from 'svelte';
	import { drawerState } from '$lib/data/mainStore';
	import NavigationV3 from '$lib/components/navigation-v3.svelte';

	let { children } = $props();

	onMount(async () => {
		if (pwaInfo) {
			const { useRegisterSW } = await import('virtual:pwa-register/svelte');
			useRegisterSW({
				immediate: true,
				onRegistered(r) {
					// uncomment following code if you want check for updates
					// r && setInterval(() => {
					//    console.log('Checking for sw update')
					//    r.update()
					// }, 20000 /* 20s for testing purposes */)
					console.log(`SW Registered: ${r}`);
				},
				onRegisterError(error) {
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
	{#each pwaAssetsHead.links as link (link)}
		<link {...link} />
	{/each}
</svelte:head>

<div class="drawer" style="touch-action: pan-y" {...useSwipe(handleSwipe, () => ({ touchAction: 'pan-y', timeframe: 300, threshold: 30 }))}>
	<!-- sidebar as modal -->
	<input type="checkbox" id="drawer-modal" class="drawer-toggle" bind:checked={$drawerState} />
	<div class="drawer-content h-screen">
		<!-- former AppShell -->
		<div class="grid grid-cols-1 lg:grid-cols-[288px_1fr] h-screen">
			<aside class="sticky top-0 col-span-1 hidden h-screen overflow-y-auto lg:block">
				<!-- bg-surface-500/5 -->
				<!-- <Navigation /> -->
				<NavigationV3 />
			</aside>

			<main class="col-span-1 bg-base-300 h-full overflow-auto">
				{@render children()}
			</main>
		</div>
	</div>
	<div class="drawer-side">
		<label for="drawer-modal" class="drawer-overlay"></label>
		<div class="bg-base-200 w-[288px] h-screen overflow-y-auto">
			<!-- <Navigation /> -->
			<NavigationV3 />
		</div>
	</div>
</div>

{#await import('$lib/components/ReloadPrompt.svelte') then { default: ReloadPrompt }}
	<ReloadPrompt />
{/await}
