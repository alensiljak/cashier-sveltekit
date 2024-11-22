<script lang="ts">
	import { ArrowBigUpIcon, ArrowDownIcon, CircleCheckIcon } from 'lucide-svelte';
	import ToolbarMenuItem from './ToolbarMenuItem.svelte';
</script>

<div class="list-nav variant-filled-primary p-3" data-popup="popupClick">
	<ul>
		<li>
			<ToolbarMenuItem text="Backup Settings">
				{#snippet icon()}
                <ArrowDownIcon />
				{/snippet}
			</ToolbarMenuItem>
		</li>
		<li>
			<ToolbarMenuItem text="Restore Settings" targetNav="/settings">
				{#snippet icon()}
                <ArrowBigUpIcon />
				{/snippet}
			</ToolbarMenuItem>
		</li>
		<li>
			<ToolbarMenuItem text="X">
				{#snippet icon()}
                <CircleCheckIcon />
				{/snippet}
			</ToolbarMenuItem>
		</li>
	</ul>
</div>
