<script lang="ts">
	import { Navigation } from '@skeletonlabs/skeleton-svelte';
	// Icons
	import IconSettings from '@lucide/svelte/icons/settings';
	import { page } from '$app/state';
	import { CalendarClockIcon, ChartPieIcon, DatabaseIcon, HelpCircleIcon, HomeIcon, InfoIcon, LandmarkIcon, ScrollIcon, SettingsIcon, StarIcon, UsersRoundIcon } from '@lucide/svelte';

    const hoverClass = 'hover:bg-primary-500/25'
    const activeClass = 'bg-secondary-500/50'

	let isExpanded = $state(true);

	function toggleExpanded() {
		isExpanded = !isExpanded;
	}
</script>

<!-- <div class="card border-surface-100-900 grid h-[760px] w-full grid-cols-[auto_1fr] border-[1px]"> -->
<!-- Component -->
<Navigation.Rail
	expanded={isExpanded}
	classes="w-full bg-surface-900 text-tertiary-100 preset-tonal-tertiary-900-100"
	tilesJustify="top"
	padding="p-0"
>
<!-- 
preset-tonal-tertiary-900-100
bg-surface-900 text-tertiary-50 
 hover:bg-primary-200-->
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
		<Navigation.Tile labelExpanded="Browse Files" href="/" hover={hoverClass} active={activeClass}
            selected={page.url.pathname === '/'} >
			<HomeIcon />
		</Navigation.Tile>
		<Navigation.Tile labelExpanded="Journal" href="/journal" hover={hoverClass} active={activeClass}
            selected={page.url.pathname === '/journal'}>
			<ScrollIcon />
		</Navigation.Tile>
        <Navigation.Tile labelExpanded="Browse Music" href="/music" hover={hoverClass} active={activeClass}
            selected={page.url.pathname === '/music'}>
            <StarIcon />
        </Navigation.Tile>
        <Navigation.Tile labelExpanded="Browse Videos" href="/videos" hover={hoverClass} active={activeClass}
            selected={page.url.pathname === '/videos'}>
            <LandmarkIcon />
        </Navigation.Tile>
        <Navigation.Tile labelExpanded="Browse Games" href="/games" hover={hoverClass} active={activeClass}
            selected={page.url.pathname === '/games'}>
            <UsersRoundIcon />
        </Navigation.Tile>
        <Navigation.Tile labelExpanded="Browse Games" href="/games" hover={hoverClass} active={activeClass}
            selected={page.url.pathname === '/games'}>
            <ChartPieIcon />
        </Navigation.Tile>
        <Navigation.Tile labelExpanded="Browse Games" href="/games" hover={hoverClass} active={activeClass}
            selected={page.url.pathname === '/games'}>
            <CalendarClockIcon />
        </Navigation.Tile>
        <Navigation.Tile labelExpanded="Browse Games" href="/games" hover={hoverClass} active={activeClass}
            selected={page.url.pathname === '/games'}>
            <DatabaseIcon />
        </Navigation.Tile>
        <Navigation.Tile labelExpanded="Browse Games" href="/games" hover={hoverClass} active={activeClass}
            selected={page.url.pathname === '/games'}>
            <SettingsIcon />
        </Navigation.Tile>
        <Navigation.Tile labelExpanded="Browse Games" href="/games" hover={hoverClass} active={activeClass}
            selected={page.url.pathname === '/games'}>
            <HelpCircleIcon />
        </Navigation.Tile>
        <Navigation.Tile labelExpanded="About" href="/about" hover={hoverClass} active={activeClass}
            selected={page.url.pathname === '/about'}>
            <InfoIcon />
        </Navigation.Tile>
	{/snippet}
	{#snippet footer()}
		<Navigation.Tile labelExpanded="Settings" href="/settings" title="Settings">
			<SettingsIcon />
		</Navigation.Tile>
	{/snippet}
</Navigation.Rail>

<!-- Content -->
<!-- <div class="flex items-center justify-center">
      <p class="opacity-20">(Content)</p>
    </div> -->
<!-- </div> -->
<style>
	/* active navigation item style */
	/* replace @apply bg-secondary-500; */
	/* .active {
		background-color: var(--color-secondary-500);
	} */
</style>
