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
	<div class="navbar bg-primary text-base-content h-12 min-h-12 py-1 shadow-sm">
		<div class="flex-none">
			<button
				class="btn btn-square btn-ghost hover-transparent rounded border-0 lg:hidden"
				onclick={toggleSidebar}
			>
				<span>
					<Menu size={20} />
				</span>
			</button>
		</div>
		<div class="flex-1">
			<p class="w-full pl-0 text-xl leading-7 font-bold">{title}</p>
		</div>
		{#if menuItems}
			<div class="flex-none">
				<div class="dropdown dropdown-end">
					<button
						tabindex="0"
						class="btn btn-ghost btn-circle hover-transparent"
					>
						<EllipsisVertical size={18} />
					</button>
					<ul
						role="menu"
						class="menu menu-sm dropdown-content bg-primary rounded-box z-1 mt-1 w-52 p-2 shadow"
					>
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
