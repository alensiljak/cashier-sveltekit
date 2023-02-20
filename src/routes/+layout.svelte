<script lang="ts">
	import { onDestroy } from 'svelte';
	import Sidebar from '$lib/Sidebar.svelte';
	import TopBar from '$lib/TopBar.svelte';
	import { onMount } from 'svelte';
	import { pwaInfo } from 'virtual:pwa-info';
	import { AppContent } from '@smui/drawer';
	import { drawerVisible } from '$lib/store';

	// let is_drawer_open = true; // drawerVisible


	/// PWA reload
	let ReloadPrompt: any;
	onMount(async () => {
		pwaInfo && (ReloadPrompt = (await import('$lib/ReloadPrompt.svelte')).default);
	});

	$: webManifest = pwaInfo ? pwaInfo.webManifest.linkTag : '';
	///

</script>

<svelte:head>
	{@html webManifest}
</svelte:head>

<Sidebar />
<AppContent>
	<TopBar />
	<main>
		<slot />
	</main>
	
</AppContent>

{#if ReloadPrompt}
	<svelte:component this={ReloadPrompt} />
{/if}
