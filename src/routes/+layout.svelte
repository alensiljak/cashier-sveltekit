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
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { drawerState, ShortDateFormatStore } from '$lib/data/mainStore';
	import NavigationV3 from '$lib/components/navigation.svelte';
	import Notifier from '$lib/utils/notifier';
	import { ensureInitialized } from '$lib/data/initializer';
	import { SettingKeys, settings } from '$lib/settings';
	import { SHORT_DATE_FORMAT_DEFAULT } from '$lib/constants';
	import { navigating } from '$app/state';

	let { children } = $props();

	// Immediate feedback while a client-side navigation is in flight — some
	// routes take ~1s to render, and without this the tap/click looks like it
	// did nothing. Touch devices get a visible top progress bar (cursor changes
	// are invisible there); desktop/mouse users additionally get a wait cursor.
	let isNavigating = $derived(navigating.to !== null);

	$effect(() => {
		document.documentElement.classList.toggle('app-navigating', isNavigating);
	});

	onMount(() => {
		// Surface otherwise-silent failures (e.g. the sync/beancount redirect bug)
		// loudly in the console instead of letting them fail invisibly.
		window.addEventListener('error', (event) => {
			console.error('[GlobalError]', event.error ?? event.message, event);
		});
		window.addEventListener('unhandledrejection', (event) => {
			console.error('[UnhandledRejection]', event.reason);
		});
	});

	onMount(async () => {
		// Initialize the Ledger service.
		const initialized = await initializeApp();
		if (!initialized) {
			Notifier.error('Failed to initialize the engine.');
			return;
		}

		if (pwaInfo) {
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

	async function initializeApp(): Promise<boolean> {
		// Check if the main ledger file exists?
		await ensureInitialized();

		const savedShortDateFormat = await settings.get<string>(SettingKeys.shortDateFormat);
		ShortDateFormatStore.set(savedShortDateFormat ?? SHORT_DATE_FORMAT_DEFAULT);

		try {
			await fullLedgerService.ensureLoaded();
			console.log('FullLedgerService loaded and ready');
			return true;
		} catch (err) {
			console.error('Failed to initialize FullLedgerService:', err);
			Notifier.error('Failed to initialize the engine.' + err);
			return false;
		}
	}

	function handleSwipe(e: SwipeCustomEvent) {
		if (e.detail.direction == 'right') {
			drawerState.update((state) => true);
		}
		if (e.detail.direction == 'left') {
			drawerState.update((state) => false);
		}
	}

	function handleDrawerSideSwipe(e: SwipeCustomEvent) {
		if (e.detail.direction == 'left') {
			drawerState.update((state) => false);
		}
	}
</script>

{#if isNavigating}
	<div class="nav-progress bg-primary" aria-hidden="true"></div>
{/if}

<svelte:head>
	<title>Cashier</title>

	<!-- PWA -->
	<base href="/" />
	{#each pwaAssetsHead.links as link (link)}
		<link {...link} />
	{/each}
</svelte:head>

<div class="drawer">
	<!-- sidebar as modal -->
	<input type="checkbox" id="drawer-modal" class="drawer-toggle" bind:checked={$drawerState} />
	<div class="drawer-content h-screen">
		<!-- former AppShell -->
		<div class="grid grid-cols-1 lg:grid-cols-[288px_1fr] h-screen">
			<aside class="sticky top-0 col-span-1 hidden h-screen overflow-y-auto lg:block">
				<!-- <Navigation /> -->
				<NavigationV3 />
			</aside>

			<main
				class="col-span-1 bg-base-300 h-full overflow-auto touch-pan-y"
				{...useSwipe(handleSwipe, () => ({
					timeframe: 350,
					minSwipeDistance: 25,
					touchAction: 'pan-y'
				}))}
			>
				{@render children()}
			</main>
		</div>
	</div>
	<div
		class="drawer-side"
		{...useSwipe(handleDrawerSideSwipe, () => ({
			timeframe: 350,
			minSwipeDistance: 25,
			touchAction: 'pan-y'
		}))}
	>
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

<style>
	.nav-progress {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		z-index: 1000;
		transform-origin: left;
		animation: nav-progress-grow 1s ease-out infinite;
	}

	@keyframes nav-progress-grow {
		0% {
			transform: scaleX(0);
			opacity: 1;
		}
		70% {
			transform: scaleX(0.85);
			opacity: 1;
		}
		100% {
			transform: scaleX(0.95);
			opacity: 0.6;
		}
	}
</style>
