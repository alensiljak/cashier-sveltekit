<script lang="ts">
	import Drawer, { Header, Title, Subtitle } from '@smui/drawer';
</script>

<div>Sidebar!</div>

<!-- Drawer / Sidebar -->
<nav class="drawer-container">
	<!-- bind:is_drawer_open -->
	<Drawer variant="dismissible">
		<Header>
			<Title>Super Drawer</Title>
			<Subtitle>It's the best drawer.</Subtitle>
		</Header>
	</Drawer>
</nav>
