<script lang="ts">
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import { EllipsisVertical, Menu } from 'lucide-svelte';
	import { getDrawerStore, popup, type PopupSettings } from '@skeletonlabs/skeleton';
	import type { Snippet } from 'svelte';

	const drawerStore = getDrawerStore();
	const popupClick: PopupSettings = {
		event: 'click',
		target: 'popupClick',
		placement: 'top'
	};

	// Props
	type Props = {
		title?: string;
		menuItems?: Snippet;
	};
	let { title = 'Cashier', menuItems }: Props = $props();

	// methods

	function toggleSidebar() {
		drawerStore.open();
	}
</script>

<!-- Toolbar for pages -->
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
		<!-- <strong class="text-xl uppercase">Skeleton</strong> -->
	<h4 class="h4 leading-9 pl-0">{title}</h4>
	{/snippet}
	<!-- {#snippet children()}
	{/snippet} -->
	{#snippet trail()}
		<!-- Drop-down Menu -->
		{#if menuItems}
			<button class="btn py-1 pr-2" use:popup={popupClick}>
				<EllipsisVertical size={20} class="" />
			</button>
			<!-- Pop-up Menu -->
			<div class="list-nav variant-filled-primary p-3 shadow" data-popup="popupClick">
				<ul>
					{@render menuItems?.()}
				</ul>
			</div>
		{/if}
	{/snippet}
	<!-- {#snippet headline()}
			<h2 class="h2">Headline</h2>
		{/snippet} -->

	<!-- <h4 class="h4 leading-9">{title}</h4> -->
</AppBar>
