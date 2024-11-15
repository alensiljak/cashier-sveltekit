<script lang="ts">
	import { swipe, type SwipeCustomEvent } from 'svelte-gestures';
    import { 
        getDrawerStore,
	} from '@skeletonlabs/skeleton';
	import Navigation from '$lib/navigation.svelte';
	import { fade } from 'svelte/transition';

	const drawerStore = getDrawerStore();

	let alertVisible: boolean = false;

	function handleSwipe(e: SwipeCustomEvent) {
		// alert('yo!')
		// console.log(e.detail.direction);
		if (e.detail.direction == 'right') {
			alertVisible = true;
			drawerStore.open();
		}
		if (e.detail.direction == 'left') {
			alertVisible = false;
			drawerStore.close();
		}
	}

</script>

<div class="grid grid-cols-[auto_1fr]" use:swipe on:swipe={handleSwipe}>
	<!-- grid grid-cols-2 md:grid-cols-[auto_1fr] -->
	<!-- Hide the sidebar on small screens; show at the medium breakpoint or wider -->
	<div class="w-0 bg-surface-500/5 lg:w-64">
		<aside class="sticky top-0 col-span-1 h-screen bg-yellow-500 p-4">
			<!-- <Drawer width="w-[300px]">Cashier</Drawer> -->
			<Navigation />
		</aside>
	</div>
	<!-- App Shell -->
	<article class="col-span-1">
		<slot></slot>

		{#if alertVisible}
			<aside class="alert variant-ghost" transition:fade={{ duration: 200 }}>
				<!-- Icon -->
				<div>(icon)</div>
				<!-- Message -->
				<div class="alert-message">
					<h3 class="h3">(title)</h3>
					<p>yo!</p>
				</div>
				<!-- Actions -->
				<div class="alert-actions">(buttons)</div>
			</aside>
		{/if}
	</article>
</div>