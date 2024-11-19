<script lang="ts">
	import { getDrawerStore } from '@skeletonlabs/skeleton';

	const drawerStore = getDrawerStore();

	function drawerClose(): void {
		drawerStore.close();
	}
</script>

<!-- This is the navigation component. -->

<div class="flex justify-center items-center w-100 p-4">
	<img src="https://cashier-ii.alensiljak.eu.org/icon-192.png" class="w-40" alt="logo" />
</div>

<nav class="list-nav p-4">
	<ul>
		<li><a href="/" on:click={drawerClose}>Homepage</a></li>
		<li><a href="/journal" on:click={drawerClose}>Journal</a></li>
		<li><a href="/favourites" on:click={drawerClose}>Favourites</a></li>
		<li><a href="/accounts" on:click={drawerClose}>Accounts</a></li>
		<li><a href="/payees" on:click={drawerClose}>Payees</a></li>
		<li><a href="/asset-allocation" on:click={drawerClose}>Asset Allocation</a></li>
		<li><a href="/scheduled-xacts" on:click={drawerClose}>Scheduled Transactions</a></li>
		<hr>
		<li><a href="/cloud-backup" on:click={drawerClose}>Cloud Backup</a></li>
		<li><a href="/settings" on:click={drawerClose}>Settings</a></li>
		<li><a href="/help" on:click={drawerClose}>Help</a></li>
		<li><a href="/about" on:click={drawerClose}>About</a></li>
	</ul>
</nav>
