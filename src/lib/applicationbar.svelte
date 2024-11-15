<script>
	import { AppBar } from '@skeletonlabs/skeleton';

	function drawerOpen() {
		// drawerStore.open();
	}
</script>

<!-- App Bar -->
<AppBar>
	<svelte:fragment slot="lead">
		<div class="flex items-center">
			<button class="btn btn-sm mr-4 lg:hidden" on:click={drawerOpen} aria-label="menu">
				<span>
					<svg viewBox="0 0 100 80" class="fill-token h-4 w-4">
						<rect width="100" height="20" />
						<rect y="30" width="100" height="20" />
						<rect y="60" width="100" height="20" />
					</svg>
				</span>
			</button>
			<strong class="text-xl uppercase">Skeleton</strong>
		</div>
	</svelte:fragment>
	<svelte:fragment slot="trail">
		<a class="btn btn-sm" href="/">Home</a>
		<a class="btn btn-sm" href="/about">About</a>
	</svelte:fragment>
</AppBar>
