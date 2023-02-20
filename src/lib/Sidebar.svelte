<!-- Drawer / Sidebar -->

<script lang="ts">
	import Drawer, { Header, Title, Subtitle } from '@smui/drawer';
	import { drawerVisible } from '$lib/store';
	import { onDestroy } from 'svelte';

	let open = $drawerVisible;

	const unsubscribe = drawerVisible.subscribe(value => {
		open = value;
	});
	onDestroy(unsubscribe);
</script>

<Drawer variant="dismissible" bind:open>
	<Header>
		<Title>Super Drawer</Title>
		<Subtitle>It's the best drawer.</Subtitle>
	</Header>
</Drawer>
