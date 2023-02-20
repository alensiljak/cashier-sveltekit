<!-- Drawer / Sidebar -->

<script lang="ts">
	import Drawer, { Header, Title, Subtitle } from '@smui/drawer';
	import { drawerVisible } from '$lib/store';
	import { onDestroy } from 'svelte';
	import Scrim from '@smui/drawer/src/Scrim.svelte';

	let open = $drawerVisible;

	const unsubscribe = drawerVisible.subscribe(value => {
		open = value;
	});
	onDestroy(unsubscribe);
</script>
<!-- variant="dismissible" -->
<Drawer variant="modal" fixed={false} bind:open>
	<Header>
		<Title>Super Drawer</Title>
		<Subtitle>It's the best drawer.</Subtitle>
		
		<button>?</button>
	</Header>
</Drawer>
<Scrim fixed={false} />