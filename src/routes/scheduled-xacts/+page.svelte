<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import SearchToolbar from '$lib/components/SearchToolbar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { ISODATEFORMAT } from '$lib/constants';
	import db from '$lib/data/db';
	import type { ScheduledTransaction } from '$lib/data/model';
	import { ListSearch } from '$lib/utils/ListSearch';
	import { CalendarIcon, PackageIcon, PackageOpenIcon, PlusIcon } from 'lucide-svelte';
	import moment from 'moment';
	import { onMount } from 'svelte';

	let allItems: ScheduledTransaction[] = $state([]);
	let filteredList: ScheduledTransaction[] = $state([]);
	let currentDate = null;
	const today = moment().format(ISODATEFORMAT);

	onMount(async () => {
		await loadData();

		// await calculateAmounts()
	});

	async function loadData() {
		let sorted = await db.scheduled
			.orderBy('nextDate')
			//.sortBy('symbol')
			.toArray();

		// sort also by payee, case insensitive
		sorted.sort((a, b) => {
			const tx1 = a.transaction;
			const tx2 = b.transaction;

			var sorting = a.nextDate.localeCompare(b.nextDate);
			return sorting == 0
				? tx1.payee.localeCompare(tx2.payee, 'en', { sensitivity: 'base' })
				: sorting;
		});

		allItems = sorted;
		filteredList = sorted;
	}

	async function onBackupClick() {}

	async function onFabClicked() {
		// reset any cached values
		//   mainStore.newScheduledTx()
		//   mainStore.newTx()
		//   router.push({ name: 'scheduledtxeditor' })
	}

	async function onRestoreClick() {}

	async function onSearch(value: string) {
		if (value) {
			// Apply filter
			let search = new ListSearch();
			let regex = search.getRegex(value);

			filteredList = allItems.filter((sx) => regex.test(sx.transaction?.payee as string));
		} else {
			// Clear filter. Use all records.
			filteredList = allItems;
		}
	}
</script>

<div class="flex h-screen flex-col">
	<Toolbar title="Scheduled Transactions">
		{#snippet menuItems()}
			<ToolbarMenuItem Icon={PackageIcon} text="Backup" />
			<ToolbarMenuItem Icon={PackageOpenIcon} text="Restore" targetNav="/restore/scheduled" />
			<ToolbarMenuItem Icon={CalendarIcon} text="Calendar" />
		{/snippet}
	</Toolbar>
	<!-- search toolbar -->
	<SearchToolbar focus {onSearch} />

	<Fab onclick={onFabClicked} Icon={PlusIcon} />

	<main class="p-1 grow overflow-auto">
		{#if filteredList.length === 0}
			<p>No scheduled transactions found</p>
		{:else}
			<!-- list -->
			<div>
				{#each filteredList as scx, i}
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
</div>
