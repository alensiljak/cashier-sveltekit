<script lang="ts">
	import { page } from '$app/state';
	import { drawerState } from '$lib/data/mainStore';
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
		UploadCloudIcon,
		DatabaseIcon
	} from '@lucide/svelte';

	function drawerClose(): void {
		// the new drawer
		drawerState.update((state) => false);
	}
</script>

<!-- This is the navigation component. -->

<div class="bg-primary p-4">
	<div class="flex w-100 items-center justify-center">
		<img src="/icons/icon-192.png" class="w-1/3 lg:w-1/2" alt="logo" />
	</div>
	<div class="pt-2 text-center">
		<h3 class="h3">Cashier</h3>
	</div>
</div>

<ul class="menu menu-lg p-4">
	<li>
		<a href="/" onclick={drawerClose} class="{page.url.pathname === '/' ? 'active' : ''}">
			<HomeIcon />
			<span>Home</span>
		</a>
	</li>
	<li>
		<a href="/journal" onclick={drawerClose} class="{page.url.pathname === '/journal' ? 'active' : ''}">
			<ScrollIcon />
			<span>Journal</span>
		</a>
	</li>
	<li>
		<a href="/favourites" onclick={drawerClose} class="{page.url.pathname === '/favourites' ? 'active' : ''}">
			<StarIcon />
			<span>Favourites</span>
		</a>
	</li>
	<li>
		<a href="/accounts" onclick={drawerClose} class="{page.url.pathname === '/accounts' ? 'active' : ''}">
			<LandmarkIcon />
			<span>Accounts</span>
		</a>
	</li>
	<li>
		<a href="/payees" onclick={drawerClose} class="{page.url.pathname === '/payees' ? 'active' : ''}">
			<UsersRoundIcon />
			<span>Payees</span>
		</a>
	</li>
	<li>
		<a href="/asset-allocation" onclick={drawerClose} class="{page.url.pathname === '/asset-allocation' ? 'active' : ''}">
			<ChartPieIcon />
			<span>Asset Allocation</span>
		</a>
	</li>
	<li>
		<a href="/scheduled-xacts" onclick={drawerClose} class="{page.url.pathname === '/scheduled-xacts' ? 'active' : ''}">
			<CalendarClockIcon />
			<span>Scheduled Transactions</span>
		</a>
	</li>
</ul>

<div class="divider"></div>

<ul class="menu menu-lg p-4">
	<li>
		<a href="/backup" onclick={drawerClose} class="{page.url.pathname === '/backup' ? 'active' : ''}">
			<DatabaseIcon />
			<span>Backup</span>
		</a>
	</li>
	<li>
		<a href="/settings" onclick={drawerClose} class="{page.url.pathname === '/settings' ? 'active' : ''}">
			<SettingsIcon />
			<span class="flex-auto">Settings</span>
		</a>
	</li>
	<li>
		<a href="/help" onclick={drawerClose} class="{page.url.pathname === '/help' ? 'active' : ''}">
			<HelpCircleIcon />
			<span class="flex-auto">Help</span>
		</a>
	</li>
	<li>
		<a href="/about" onclick={drawerClose} class="{page.url.pathname === '/about' ? 'active' : ''}">
			<InfoIcon />
			<span>About</span>
		</a>
	</li>
</ul>
