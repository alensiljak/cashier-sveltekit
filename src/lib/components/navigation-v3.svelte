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

<div class="flex flex-col h-screen bg-base-200">
	<div class="bg-primary w-full p-4">
		<div class="flex w-full items-center justify-center">
			<img src="/icons/icon-192.png" class="w-1/3 lg:w-1/2" alt="logo" />
		</div>
		<div class="pt-2 text-center">
			<p class="text-xl font-semibold">Cashier</p>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto">
		<ul class="menu menu-lg w-full">
			<li>
				<a href="/" class="w-full flex items-center gap-2 {page.url.pathname === '/' ? 'active bg-secondary text-secondary-content' : ''}" onclick={closeDrawer}>
					<HomeIcon />
					<span>Home</span>
				</a>
			</li>
			<li>
				<a href="/journal" class="w-full flex items-center gap-2 {page.url.pathname === '/journal' ? 'active bg-secondary text-secondary-content' : ''}" onclick={closeDrawer}>
					<ScrollIcon />
					<span>Journal</span>
				</a>
			</li>
			<li>
				<a href="/favourites" class="w-full flex items-center gap-2 {page.url.pathname === '/favourites' ? 'active bg-secondary text-secondary-content' : ''}" onclick={closeDrawer}>
					<StarIcon />
					<span>Favourites</span>
				</a>
			</li>
			<li>
				<a href="/accounts" class="w-full flex items-center gap-2 {page.url.pathname === '/accounts' ? 'active bg-secondary text-secondary-content' : ''}" onclick={closeDrawer}>
					<LandmarkIcon />
					<span>Accounts</span>
				</a>
			</li>
			<li>
				<a href="/payees" class="w-full flex items-center gap-2 {page.url.pathname === '/payees' ? 'active bg-secondary text-secondary-content' : ''}" onclick={closeDrawer}>
					<UsersRoundIcon />
					<span>Payees</span>
				</a>
			</li>
			<li>
				<a href="/asset-allocation" class="w-full flex items-center gap-2 {page.url.pathname === '/asset-allocation' ? 'active bg-secondary text-secondary-content' : ''}" onclick={closeDrawer}>
					<ChartPieIcon />
					<span>Asset Allocation</span>
				</a>
			</li>
			<li>
				<a href="/scheduled-xacts" class="w-full flex items-center gap-2 {page.url.pathname === '/scheduled-xacts' ? 'active bg-secondary text-secondary-content' : ''}" onclick={closeDrawer}>
					<CalendarClockIcon />
					<span>Scheduled Transactions</span>
				</a>
			</li>
		</ul>

		<div class="divider divider-primary m-2"></div>

		<ul class="menu menu-lg w-full">
			<li>
				<a href="/backup" class="w-full flex items-center gap-2 {page.url.pathname === '/backup' ? 'active bg-secondary text-secondary-content' : ''}" onclick={closeDrawer}>
					<DatabaseIcon />
					<span>Backup</span>
				</a>
			</li>
			<li>
				<a href="/help" class="w-full flex items-center gap-2 {page.url.pathname === '/help' ? 'active bg-secondary text-secondary-content' : ''}" onclick={closeDrawer}>
					<HelpCircleIcon />
					<span>Help</span>
				</a>
			</li>
			<li>
				<a href="/about" class="w-full flex items-center gap-2 {page.url.pathname === '/about' ? 'active bg-secondary text-secondary-content' : ''}" onclick={closeDrawer}>
					<InfoIcon />
					<span>About</span>
				</a>
			</li>
		</ul>
	</div>

	<!-- Settings button at the bottom -->
	<ul class="menu menu-lg w-full mt-auto">
		<li>
			<a href="/settings" class="w-full flex items-center gap-2 {page.url.pathname === '/settings' ? 'active bg-secondary text-secondary-content' : ''}" onclick={closeDrawer}>
				<SettingsIcon />
				<span>Settings</span>
			</a>
		</li>
	</ul>
</div>
