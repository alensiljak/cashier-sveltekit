<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	type Props = {
		title: string;
		expanded: boolean;
		onToggle: () => void;
		badge?: string | number;
		children: Snippet;
	};
	let { title, expanded, onToggle, badge, children }: Props = $props();
</script>

<section class="card bg-base-100 shadow-xl">
	<div
		role="button"
		tabindex="0"
		aria-pressed={expanded}
		class="card-body p-4 cursor-pointer"
		onclick={onToggle}
		onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { onToggle(); } }}
	>
		<div class="flex items-center justify-between">
			<h2 class="card-title m-0">
				{title}
				{#if badge !== undefined}
					<span>({badge})</span>
				{/if}
			</h2>
			<ChevronRight
				class="w-6 h-6 transition-transform duration-200 {expanded ? 'rotate-90' : ''}"
			/>
		</div>
	</div>
	{#if expanded}
		<div class="px-4 pb-4">
			{@render children()}
		</div>
	{/if}
</section>
