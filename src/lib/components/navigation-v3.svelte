<script lang="ts">
	import { drawerState } from '$lib/data/mainStore';
	import { page } from '$app/state';
	// Icons
	import {
		CalendarClockIcon,
		ChartPieIcon,
		DatabaseIcon,
		HelpCircleIcon,
		HomeIcon,
		InfoIcon,
		LandmarkIcon,
		ScrollIcon,
		SettingsIcon,
		StarIcon,
		UsersRoundIcon
	} from '@lucide/svelte';

	function closeDrawer(): void {
		// the new drawer
		drawerState.update((state) => false);
	}
</script>

<div class="w-full bg-base-200 text-tertiary-100">
	<div class="bg-primary-500 w-full p-4">
		<div class="flex w-full items-center justify-center">
			<img src="/icons/icon-192.png" class="w-1/3 lg:w-1/2" alt="logo" />
		</div>
		<div class="pt-2 text-center">
			<h5 class="text-lg font-semibold">Cashier</h5>
		</div>
	</div>

	<ul class="menu menu-lg">
		<li>
			<a href="/" class="{page.url.pathname === '/' ? 'active' : ''}" onclick={closeDrawer}>
				<HomeIcon />
				<span>Home</span>
			</a>
		</li>
		<li>
			<a href="/journal" class="{page.url.pathname === '/journal' ? 'active' : ''}" onclick={closeDrawer}>
				<ScrollIcon />
				<span>Journal</span>
			</a>
		</li>
		<li>
			<a href="/favourites" class="{page.url.pathname === '/favourites' ? 'active' : ''}" onclick={closeDrawer}>
				<StarIcon />
				<span>Favourites</span>
			</a>
		</li>
		<li>
			<a href="/accounts" class="{page.url.pathname === '/accounts' ? 'active' : ''}" onclick={closeDrawer}>
				<LandmarkIcon />
				<span>Accounts</span>
			</a>
		</li>
		<li>
			<a href="/payees" class="{page.url.pathname === '/payees' ? 'active' : ''}" onclick={closeDrawer}>
				<UsersRoundIcon />
				<span>Payees</span>
			</a>
		</li>
		<li>
			<a href="/asset-allocation" class="{page.url.pathname === '/asset-allocation' ? 'active' : ''}" onclick={closeDrawer}>
				<ChartPieIcon />
				<span>Asset Allocation</span>
			</a>
		</li>
		<li>
			<a href="/scheduled-xacts" class="{page.url.pathname === '/scheduled-xacts' ? 'active' : ''}" onclick={closeDrawer}>
				<CalendarClockIcon />
				<span>Scheduled Transactions</span>
			</a>
		</li>
	</ul>

	<div class="divider"></div>

	<ul class="menu menu-lg">
		<li>
			<a href="/backup" class="{page.url.pathname === '/backup' ? 'active' : ''}" onclick={closeDrawer}>
				<DatabaseIcon />
				<span>Backup</span>
			</a>
		</li>
		<li>
			<a href="/help" class="{page.url.pathname === '/help' ? 'active' : ''}" onclick={closeDrawer}>
				<HelpCircleIcon />
				<span>Help</span>
			</a>
		</li>
		<li>
			<a href="/about" class="{page.url.pathname === '/about' ? 'active' : ''}" onclick={closeDrawer}>
				<InfoIcon />
				<span>About</span>
			</a>
		</li>
	</ul>

	<div class="fixed bottom-0 w-full p-2">
		<ul class="menu menu-lg">
			<li>
				<a href="/settings" class="{page.url.pathname === '/settings' ? 'active' : ''}" onclick={closeDrawer}>
					<SettingsIcon />
					<span>Settings</span>
				</a>
			</li>
		</ul>
	</div>
</div>
