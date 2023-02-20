<script lang="ts">
	import { onDestroy } from 'svelte';
	import Sidebar from '$lib/Sidebar.svelte';
	import TopBar from '$lib/TopBar.svelte';
	// import { drawerVisible } from '../store/store';
	import { onMount } from 'svelte';
	import { pwaInfo } from 'virtual:pwa-info';
	import { drawerVisible } from '$lib/store'

	// let is_drawer_open = true; // drawerVisible

	// drawerVisible.subscribe((value) => is_drawer_open = value);

	/// PWA reload
	let ReloadPrompt: any;
	onMount(async () => {
		pwaInfo && (ReloadPrompt = (await import('$lib/ReloadPrompt.svelte')).default);
	});

	$: webManifest = pwaInfo ? pwaInfo.webManifest.linkTag : '';
	///

	// Drawer
	// let showDrawer: boolean;
	// const unsubscribe = drawerVisible.subscribe(value => {
	// 	showDrawer = value;
	// });
	// onDestroy(unsubscribe);
</script>

<svelte:head>
	{@html webManifest}
</svelte:head>

<p>This is the layout</p>

{#if $drawerVisible}
<Sidebar />
{/if}
<div>
	<TopBar />
	<main>
		<slot />
	</main>
</div>

{#if ReloadPrompt}
	<svelte:component this={ReloadPrompt} />
{/if}
