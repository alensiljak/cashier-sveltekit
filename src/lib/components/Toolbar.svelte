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
	<div class="navbar bg-primary text-primary-content h-12 min-h-12 py-1">
		<div class="navbar-start">
			<button class="btn btn-sm btn-ghost hover-transparent px-1 mx-1 lg:hidden border-0 rounded" onclick={toggleSidebar}>
				<span>
					<Menu size={20} />
				</span>
			</button>
			<p class="text-xl font-bold pl-0 leading-7">{title}</p>
		</div>
		{#if menuItems}
		<div class="navbar-end">
			<div class="dropdown dropdown-end">
				<div tabindex="0" role="button" class="btn btn-ghost btn-circle h-8 min-h-0">
					<EllipsisVertical size={18} />
				</div>
				<ul role="menu" class="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-primary rounded-box w-52">
					{@render menuItems?.()}
				</ul>
			</div>
		</div>
		{/if}
	</div>
	<div class="gloss-effect absolute inset-0"></div>
</div>

<style>
	.btn.btn-ghost.hover-transparent:hover {
		background-color: rgba(255, 255, 255, 0.15); /* Light transparent overlay for primary text */
	}

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
