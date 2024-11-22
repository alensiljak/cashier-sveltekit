<script lang="ts">
	import { ArrowBigUpIcon, ArrowDownIcon, CircleCheckIcon } from 'lucide-svelte';
	import ToolbarMenuItem from './ToolbarMenuItem.svelte';
	import { onMount, type Snippet } from 'svelte';

	type Props = {
		children: Array<Snippet>;
	};
	let { children }: Props = $props();

	onMount(() => {});
</script>

<div class="list-nav variant-filled-primary p-3" data-popup="popupClick">
	<ul>
		<!-- <li>
			{@render children?.()}
		</li> -->
		<!-- <li>
			{#each children as child}
				{@render child()}
			{/each}
		</li> -->
		<li>
			<ToolbarMenuItem text="test" Icon={ArrowDownIcon} />
		</li>
		<li>
			<ToolbarMenuItem text="Backup Settings" Icon={ArrowDownIcon} />
		</li>
		<li>
			<ToolbarMenuItem text="Restore Settings" targetNav="/settings" Icon={ArrowBigUpIcon} />
		</li>
		<li>
			<ToolbarMenuItem text="X" Icon={CircleCheckIcon} />
		</li>
	</ul>
</div>
