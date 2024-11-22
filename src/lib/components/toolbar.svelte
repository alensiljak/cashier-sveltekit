<script lang="ts">
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import { ArrowBigUpIcon, ArrowDownIcon, CircleCheckIcon, EllipsisVertical, Menu } from 'lucide-svelte';
	import { getDrawerStore, popup, type PopupSettings } from '@skeletonlabs/skeleton';
	import ToolbarMenu from './ToolbarMenu.svelte';
	import type { Snippet } from 'svelte';

	const drawerStore = getDrawerStore();
	const popupClick: PopupSettings = {
		event: 'click',
		target: 'popupClick',
		placement: 'top'
	};

	// Props
	type Props = {
		title?: string,
		children?: Snippet
	}
	// export let title: string = 'Cashier'
	let { title, children }: Props = $props()

	// methods

	function onMenuClicked() {
		console.log('menu clicked');
	}

	function toggleSidebar() {
		drawerStore.open();
	}
</script>

<!-- Toolbar for pages -->
<!-- centerClasses="sm:block lg:hidden" -->
<AppBar
	headlineClasses="sm:hidden"
	centerClasses=""
	toolbarClasses=""
	padding="p-2"
	background="bg-primary-500"
	classes=""
>
	{#snippet lead()}
		<!-- <ArrowLeft size={24} /> -->
		<button class="btn btn-sm mr-4 lg:hidden" onclick={toggleSidebar}>
			<!-- lg:hidden -->
			<span>
				<Menu size={24} />
			</span>
		</button>
		<!-- <strong class="text-xl uppercase">Skeleton</strong> -->
	{/snippet}
	{#snippet children()}
		<h4 class="h4 leading-9">{title}</h4>
	{/snippet}
	{#snippet trail()}
		<button class="btn" onclick={onMenuClicked} use:popup={popupClick}>
			<EllipsisVertical size={20} class="" />
		</button>
	{/snippet}
	<!-- {#snippet headline()}
			<h2 class="h2">Headline</h2>
		{/snippet} -->
</AppBar>

<!-- Menu -->
<ToolbarMenu>

</ToolbarMenu>
