<script lang="ts">
	import { Navigation } from '@skeletonlabs/skeleton-svelte';
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

	const hoverClass = 'hover:bg-primary-500/25';
	const activeClass = 'bg-secondary-500/50';

	let isExpanded = $state(true);

	function closeDrawer(): void {
		// the new drawer
		drawerState.update((state) => false);
	}

	function toggleExpanded() {
		isExpanded = !isExpanded;
	}
</script>

<Navigation.Rail
	expanded={isExpanded}
	classes="w-full bg-surface-900 text-tertiary-100 preset-tonal-tertiary-900-100"
	tilesJustify="top"
	padding="p-0"
>
	{#snippet header()}
		<div class="bg-primary-500 w-full p-4">
			<div class="flex w-full items-center justify-center">
				<img src="/icons/icon-192.png" class="w-1/3 lg:w-1/2" alt="logo" />
			</div>
			<div class="pt-2 text-center">
				<h5 class="h5">Cashier</h5>
			</div>
		</div>
	{/snippet}
	{#snippet tiles()}
		<Navigation.Tile
			labelExpanded="Home"
			href="/"
			hover={hoverClass}
			active={activeClass}
			selected={page.url.pathname === '/'}
			onclick={closeDrawer}
		>
			<HomeIcon />
		</Navigation.Tile>
		<Navigation.Tile
			labelExpanded="Journal"
			href="/journal"
			hover={hoverClass}
			active={activeClass}
			selected={page.url.pathname === '/journal'}
			onclick={closeDrawer}
		>
			<ScrollIcon />
		</Navigation.Tile>
		<Navigation.Tile
			labelExpanded="Favourites"
			href="/favourites"
			hover={hoverClass}
			active={activeClass}
			selected={page.url.pathname === '/favourites'}
			onclick={closeDrawer}
		>
			<StarIcon />
		</Navigation.Tile>
		<Navigation.Tile
			labelExpanded="Accounts"
			href="/accounts"
			hover={hoverClass}
			active={activeClass}
			selected={page.url.pathname === '/accounts'}
			onclick={closeDrawer}
		>
			<LandmarkIcon />
		</Navigation.Tile>
		<Navigation.Tile
			labelExpanded="Payees"
			href="/payees"
			hover={hoverClass}
			active={activeClass}
			selected={page.url.pathname === '/payees'}
			onclick={closeDrawer}
		>
			<UsersRoundIcon />
		</Navigation.Tile>
		<Navigation.Tile
			labelExpanded="Asset Allocation"
			href="/asset-allocation"
			hover={hoverClass}
			active={activeClass}
			selected={page.url.pathname === '/asset-allocation'}
			onclick={closeDrawer}
		>
			<ChartPieIcon />
		</Navigation.Tile>
		<Navigation.Tile
			labelExpanded="Scheduled Transactions"
			href="/scheduled-xacts"
			hover={hoverClass}
			active={activeClass}
			selected={page.url.pathname === '/scheduled-xacts'}
			onclick={closeDrawer}
		>
			<CalendarClockIcon />
		</Navigation.Tile>

		<hr class="hr border-primary-500 border-t-2" />

		<Navigation.Tile
			labelExpanded="Backup"
			href="/backup"
			hover={hoverClass}
			active={activeClass}
			selected={page.url.pathname === '/backup'}
			onclick={closeDrawer}
		>
			<DatabaseIcon />
		</Navigation.Tile>
		<Navigation.Tile
			labelExpanded="Help"
			href="/help"
			hover={hoverClass}
			active={activeClass}
			selected={page.url.pathname === '/help'}
			onclick={closeDrawer}
		>
			<HelpCircleIcon />
		</Navigation.Tile>
		<Navigation.Tile
			labelExpanded="About"
			href="/about"
			hover={hoverClass}
			active={activeClass}
			selected={page.url.pathname === '/about'}
			onclick={closeDrawer}
		>
			<InfoIcon />
		</Navigation.Tile>
	{/snippet}
	{#snippet footer()}
		<Navigation.Tile
			labelExpanded="Settings"
			href="/settings"
			hover={hoverClass}
			active={activeClass}
			selected={page.url.pathname === '/settings'}
			onclick={closeDrawer}
		>
			<SettingsIcon />
		</Navigation.Tile>
	{/snippet}
</Navigation.Rail>
