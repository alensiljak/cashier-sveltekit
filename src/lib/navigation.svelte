<script lang="ts">
	import { getDrawerStore } from '@skeletonlabs/skeleton';

	const drawerStore = getDrawerStore();

	function drawerClose(): void {
		drawerStore.close();
	}
</script>

<!-- This is the navigation component. -->

<div class="flex justify-center items-center">
	<img src="https://cashier-ii.alensiljak.eu.org/icon-192.png" class="w-100" alt="logo" />
</div>

<nav class="list-nav p-4 mt-4">
	<ul>
		<li><a href="/" on:click={drawerClose}>Homepage</a></li>
		<li><a href="/accounts" on:click={drawerClose}>Accounts</a></li>
		<li><a href="/journal" on:click={drawerClose}>Journal</a></li>
		<li><a href="/help" on:click={drawerClose}>Help</a></li>
		<li><a href="/about" on:click={drawerClose}>About</a></li>
	</ul>
</nav>
