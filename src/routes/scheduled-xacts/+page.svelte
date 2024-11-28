<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
import SearchToolbar from '$lib/components/SearchToolbar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import type { ScheduledTransaction } from '$lib/data/model';
	import { CalendarIcon, PackageIcon, PackageOpenIcon } from 'lucide-svelte';

	let _list: ScheduledTransaction[] = $state([]);
	let currentDate = null;

	async function onBackupClick() {}

	async function onRestoreClick() {}

	async function onSearch() {}
</script>

<Toolbar title="Scheduled Transactions">
	{#snippet menuItems()}
		<ToolbarMenuItem Icon={PackageIcon} text="Backup" />
		<ToolbarMenuItem Icon={PackageOpenIcon} text="Restore" targetNav="/restore/scheduled" />
		<ToolbarMenuItem Icon={CalendarIcon} text="Calendar" />
	{/snippet}
</Toolbar>
<!-- search toolbar -->
<SearchToolbar focus {onSearch} />

<Fab />

<main class="p-1">
	{#if _list.length === 0}
		<p>No scheduled transactions found</p>
	{:else}
		<!-- list -->
		<div>
			{#each _list as scx, i}
				{#if scx.nextDate !== currentDate}
					{@const currentDate = scx.nextDate}
					<CalendarIcon />
					<p>{scx.nextDate}</p>
				{/if}

				<p>{scx.transaction?.payee}</p>
			{/each}
		</div>
	{/if}
</main>
