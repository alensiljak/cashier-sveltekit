<script lang="ts">
	import { getDrawerStore } from '@skeletonlabs/skeleton';
	import {
		HomeIcon,
		InfoIcon,
		ScrollIcon,
		StarIcon,
		LandmarkIcon,
		UsersRoundIcon,
		ChartPieIcon,
		CalendarClockIcon,
		HelpCircleIcon,
		SettingsIcon,
		UploadCloudIcon
	} from 'lucide-svelte';

	const drawerStore = getDrawerStore();

	function drawerClose(): void {
		drawerStore.close();
	}
</script>

<!-- This is the navigation component. -->

<div class="w-100 flex items-center justify-center p-4">
	<img src="https://cashier-ii.alensiljak.eu.org/icon-192.png" class="w-40" alt="logo" />
</div>

<nav class="list-nav p-4">
	<ul>
		<li>
			<a href="/" on:click={drawerClose}>
				<span><HomeIcon /></span>
				<span class="flex-auto">Home</span>
			</a>
		</li>
		<li>
			<a href="/journal" on:click={drawerClose}>
				<span><ScrollIcon /></span>
				<span>Journal</span>
			</a>
		</li>
		<li>
			<a href="/favourites" on:click={drawerClose}>
				<span><StarIcon /></span>
				<span>Favourites</span>
			</a>
		</li>
		<li>
			<a href="/accounts" on:click={drawerClose}>
				<span><LandmarkIcon /></span>
				<span>Accounts</span>
			</a>
		</li>
		<li>
			<a href="/payees" on:click={drawerClose}>
				<span><UsersRoundIcon /></span>
				<span>Payees</span>
			</a>
		</li>
		<li>
			<a href="/asset-allocation" on:click={drawerClose}>
				<span><ChartPieIcon /></span>
				<span>Asset Allocation</span>
			</a>
		</li>
		<li>
			<a href="/scheduled-xacts" on:click={drawerClose}>
				<span><CalendarClockIcon /></span>
				<span>Scheduled Transactions</span>
			</a>
		</li>
		<hr />
		<li><a href="/cloud-backup" on:click={drawerClose}>
			<span><UploadCloudIcon /></span>
			<span>Cloud Backup</span>
		</a></li>
		<li><a href="/settings" on:click={drawerClose}>
			<span><SettingsIcon /></span>
			<span>Settings</span>
		</a></li>
		<li><a href="/help" on:click={drawerClose}>
			<span><HelpCircleIcon /></span>
			<span>Help</span>
		</a></li>
		<li><a href="/about" on:click={drawerClose}>
			<span><InfoIcon /></span>
			<span>About</span>
		</a></li>
	</ul>
</nav>
