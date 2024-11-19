<script lang="ts">
	import { AppBar } from '@skeletonlabs/skeleton-svelte';
	import Paperclip from 'lucide-svelte/icons/paperclip';
	import Calendar from 'lucide-svelte/icons/calendar';
	import CircleUser from 'lucide-svelte/icons/circle-user';
	import { EllipsisVertical, Menu } from 'lucide-svelte';
	import { getDrawerStore } from '@skeletonlabs/skeleton';

	const drawerStore = getDrawerStore();

	export let title: string = 'Cashier';

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
	toolbarClasses=""
	padding="p-2"
	background="bg-primary-500"
>
	{#snippet lead()}
		<!-- <ArrowLeft size={24} /> -->
		<button class="btn btn-sm mr-4 lg:hidden" on:click={toggleSidebar}>
			<!-- lg:hidden -->
			<span>
				<Menu size={24} />
			</span>
		</button>
		<!-- <strong class="text-xl uppercase">Skeleton</strong> -->
	{/snippet}
	{#snippet children()}
		<h4 class="h4">{title}</h4>
	{/snippet}
	{#snippet trail()}
		<button class="btn" on:click={onMenuClicked}>
			<EllipsisVertical size={20} class="" />
		</button>
	{/snippet}
	<!-- {#snippet headline()}
			<h2 class="h2">Headline</h2>
		{/snippet} -->
</AppBar>
<!-- <div class="gloss-effect absolute inset-0"></div> -->

<style>
.gloss-effect {
      background: linear-gradient(to bottom, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0));
      pointer-events: none; /* Allows interaction with underlying elements */
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
    }

</style>