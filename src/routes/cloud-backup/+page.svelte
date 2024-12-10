<!-- The card for Scheduled Transactions backup -->
<script lang="ts">
	import BackupScxCard from '$lib/components/BackupScxCard.svelte';
import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
</script>

<article>
	<Toolbar title="Cloud Backup">
		{#snippet menuItems()}
			<ToolbarMenuItem text="Settings" />
			<ToolbarMenuItem text="Clear Cache" />
		{/snippet}
	</Toolbar>
	<section class="p-1">
		<BackupScxCard />
	</section>
</article>
