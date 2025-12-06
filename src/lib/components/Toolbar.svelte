<script lang="ts">
	import { EllipsisVertical, Menu } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { drawerState } from '$lib/data/mainStore';

	// Props
	type Props = {
		title?: string;
		menuItems?: Snippet;
	};
	let { title = 'Cashier', menuItems }: Props = $props();

	// methods

	function toggleSidebar() {
		// toggle sidebar state.
		drawerState.update((state) => !state);
	}
</script>

<!-- Toolbar for pages -->
<div class="relative">
	<div class="navbar bg-primary text-primary-content">
		<div class="navbar-start">
			<button class="btn btn-sm py-1 pr-0 pl-2 lg:hidden" onclick={toggleSidebar}>
				<span>
					<Menu size={24} />
				</span>
			</button>
			<h5 class="text-lg font-semibold pl-0 leading-9">{title}</h5>
		</div>
		{#if menuItems}
		<div class="navbar-end">
			<div class="dropdown dropdown-end">
				<div tabindex="0" role="button" class="btn btn-ghost btn-circle">
					<EllipsisVertical size={20} />
				</div>
				<ul tabindex="0" class="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-primary rounded-box w-52">
					{@render menuItems?.()}
				</ul>
			</div>
		</div>
		{/if}
	</div>
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
