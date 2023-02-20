<script lang="ts">
	import { onDestroy } from 'svelte';
	import Sidebar from '$lib/Sidebar.svelte';
	import TopBar from '$lib/TopBar.svelte';
	import { onMount } from 'svelte';
	import { pwaInfo } from 'virtual:pwa-info';
	import { AppContent } from '@smui/drawer';
	import { swipe } from 'svelte-gestures';
	import { drawerVisible } from '$lib/store';

	/// PWA reload
	let ReloadPrompt: any;
	onMount(async () => {
		pwaInfo && (ReloadPrompt = (await import('$lib/ReloadPrompt.svelte')).default);
	});

	$: webManifest = pwaInfo ? pwaInfo.webManifest.linkTag : '';
	///

	// Swipe
	let direction: string;

	function handler(event: any) {
		direction = event.detail.direction;
	}

	function onSwipe(event: any) {
		// console.log('swiping');
		direction = event.detail.direction;

		if (direction == 'left') {
			drawerVisible.set(false);
		} else if (direction === 'right') {
			drawerVisible.set(true);
		}
	}
</script>

<svelte:head>
	{@html webManifest}
</svelte:head>
<svelte:body
	use:swipe={{ timeframe: 300, minSwipeDistance: 80, touchAction: 'pan-y' }}
	on:swipe={onSwipe}
/>

<Sidebar />
<AppContent>
	<TopBar />
	<main>
		<slot />

		<div>
			This one <b>swipes only in horizontal directions</b>:
			<span style="color:red;">{direction}</span><br />
			You can scroll vertically as normal. It is due to <b>touchAction: 'pan-y'</b>
		</div>
	</main>
</AppContent>
<!-- </div> -->

{#if ReloadPrompt}
	<svelte:component this={ReloadPrompt} />
{/if}

<style lang="scss">
	:global(body) {
		height: 97vh;
		//min-height: 100%;
		// background-color: red;
	}
	:global(body.dark-mode) {
		background-color: rebeccapurple;
	}
</style>
