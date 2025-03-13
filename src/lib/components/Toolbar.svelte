<script lang="ts">
	import { AppBar, Popover } from '@skeletonlabs/skeleton-svelte';
	import { EllipsisVertical, Menu } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { drawerState } from '$lib/data/mainStore';

	let menuOpenState = $state(false);

	// Props
	type Props = {
		title?: string;
		menuItems?: Snippet;
	};
	let { title = 'Cashier', menuItems }: Props = $props();

	// methods

	function onMenuClick() {
		// automatically close the menu
		menuOpenState = false;
	}

	function toggleSidebar() {
		// toggle sidebar state.
		drawerState.update((state) => !state);
	}
</script>

<!-- Toolbar for pages -->
<div class="relative">
	<AppBar
		headlineClasses="sm:hidden"
		centerClasses=""
		toolbarClasses=""
		padding="p-1.5"
		background="bg-primary-500"
		classes=""
	>
		{#snippet lead()}
			<!-- <ArrowLeft size={24} /> -->
			<button class="btn btn-sm py-1 pl-2 pr-0 lg:hidden" onclick={toggleSidebar}>
				<span>
					<Menu size={24} />
				</span>
			</button>
			<h5 class="h5 pl-0 leading-9">{title}</h5>
		{/snippet}
		<!-- {#snippet children()}
	{/snippet} -->
		{#snippet trail()}
			<!-- Drop-down Menu -->
			{#if menuItems}
				<Popover open={menuOpenState}
					onOpenChange={(e) => (menuOpenState = e.open)}
					positioning={{ placement: 'bottom-start' }}
				>
					{#snippet trigger()}
					<div class="py-1 pr-2">
						<EllipsisVertical size={20} />
					</div>
					{/snippet}
					{#snippet content()}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="list-nav preset-filled-primary-500 min-w-52 shadow-sm" onclick={onMenuClick}>
							{@render menuItems?.()}
						</div>
					{/snippet}
				</Popover>

				<!-- <button class="text-tertiary btn py-1 pr-2" use:popup={popupClick}>
					<EllipsisVertical size={20} class="" />
				</button> -->
				<!-- Pop-up Menu -->
				<!-- <div class="list-nav preset-filled-primary-500 min-w-52 shadow-sm" data-popup="popupClick">
					<menu>
						{@render menuItems?.()}
					</menu>
				</div> -->
			{/if}
		{/snippet}
		<!-- {#snippet headline()}
			<h2 class="h2">Headline</h2>
		{/snippet} -->

		<!-- <h4 class="h4 leading-9">{title}</h4> -->
	</AppBar>
	<div class="gloss-effect absolute inset-0"></div>
</div>

<style>
	.gloss-effect {
		background: linear-gradient(to bottom, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0));
		pointer-events: none; /* Allows interaction with underlying elements */
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-size: 200px; /* Adjust size for shimmer effect */
		animation: shimmer 2s infinite linear; /* Optional shimmering effect */
	}

	@keyframes shimmer {
		from {
			background-position: -200px;
		}
		to {
			background-position: 200px;
		}
	}
</style>
