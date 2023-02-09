<script lang="ts">
	import Drawer, { Header, Title, Subtitle } from '@smui/drawer';
	// import { drawerVisible } from '../store/store';
	import { onMount } from 'svelte';
	import { pwaInfo } from 'virtual:pwa-info';

	// let is_drawer_open = true; // drawerVisible

	// drawerVisible.subscribe((value) => is_drawer_open = value);

    let ReloadPrompt: any
	onMount(async () => {
        pwaInfo && (ReloadPrompt = (await import('$lib/ReloadPrompt.svelte')).default)
	});

	$: webManifest = pwaInfo ? pwaInfo.webManifest.linkTag : ''
</script>

<svelte:head>
	{@html webManifest}
</svelte:head>

<p>This is the layout</p>

<!-- Drawer / Sidebark -->
<nav class="drawer-container">
	<!-- bind:is_drawer_open -->
	<Drawer variant="dismissible">
		<Header>
			<Title>Super Drawer</Title>
			<Subtitle>It's the best drawer.</Subtitle>
		</Header>
	</Drawer>
</nav>

<main>
<slot />
</main>

{#if ReloadPrompt}
  <svelte:component this={ReloadPrompt} />
{/if}