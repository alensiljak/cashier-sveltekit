<script lang="ts">
	import { page } from '$app/stores';
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

<div class="bg-primary-500 p-4">
	<div class="w-100 flex items-center justify-center">
		<img src="/icons/icon-192.png" class="w-1/3 lg:w-1/2" alt="logo" />
	</div>
	<div class="text-center pt-2">
		<h3 class="h3">Cashier</h3>
	</div>
</div>

<nav class="list-nav p-4">
	<ul>
		<li>
			<a href="/" on:click={drawerClose} class:active={$page.url.pathname === '/'}>
				<span><HomeIcon /></span>
				<span class="flex-auto">Home</span>
			</a>
		</li>
		<li>
			<a href="/journal" on:click={drawerClose} class:active={$page.url.pathname === '/journal'}>
				<span><ScrollIcon /></span>
				<span>Journal</span>
			</a>
		</li>
		<li>
			<a
				href="/favourites"
				on:click={drawerClose}
				class:active={$page.url.pathname === '/favourites'}
			>
				<span><StarIcon /></span>
				<span>Favourites</span>
			</a>
		</li>
		<li>
			<a href="/accounts" on:click={drawerClose} class:active={$page.url.pathname === '/accounts'}>
				<span><LandmarkIcon /></span>
				<span>Accounts</span>
			</a>
		</li>
		<li>
			<a href="/payees" on:click={drawerClose} class:active={$page.url.pathname === '/payees'}>
				<span><UsersRoundIcon /></span>
				<span>Payees</span>
			</a>
		</li>
		<li>
			<a
				href="/asset-allocation"
				on:click={drawerClose}
				class:active={$page.url.pathname === '/asset-allocation'}
			>
				<span><ChartPieIcon /></span>
				<span>Asset Allocation</span>
			</a>
		</li>
		<li>
			<a
				href="/scheduled-xacts"
				on:click={drawerClose}
				class:active={$page.url.pathname === '/scheduled-xacts'}
			>
				<span><CalendarClockIcon /></span>
				<span>Scheduled Transactions</span>
			</a>
		</li>
		<hr class="bg-primary-500 h-1 border-none" />
		<li>
			<a
				href="/cloud-backup"
				on:click={drawerClose}
				class:active={$page.url.pathname === '/cloud-backup'}
			>
				<span><UploadCloudIcon /></span>
				<span>Cloud Backup</span>
			</a>
		</li>
		<li>
			<a href="/settings" on:click={drawerClose} class:active={$page.url.pathname === '/settings'}>
				<span><SettingsIcon /></span>
				<span>Settings</span>
			</a>
		</li>
		<li>
			<a href="/help" on:click={drawerClose} class:active={$page.url.pathname === '/help'}>
				<span><HelpCircleIcon /></span>
				<span>Help</span>
			</a>
		</li>
		<li>
			<a href="/about" on:click={drawerClose} class:active={$page.url.pathname === '/about'}>
				<span><InfoIcon /></span>
				<span>About</span>
			</a>
		</li>
	</ul>
</nav>

<style lang="postcss">
	/* active navigation item style */
	.active {
		@apply bg-secondary-500;
	}
</style>
