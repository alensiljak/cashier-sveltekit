<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import SearchToolbar from '$lib/components/SearchToolbar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { ISODATEFORMAT } from '$lib/constants';
	import db from '$lib/data/db';
	import type { Money, ScheduledTransaction, Xact } from '$lib/data/model';
	import { getDateColour, getMoneyColour } from '$lib/utils/formatter';
	import { ListSearch } from '$lib/utils/ListSearch';
	import Notifier from '$lib/utils/notifier';
	import { XactAugmenter } from '$lib/utils/xactAugmenter';
	import { CalendarIcon, PackageIcon, PackageOpenIcon, PlusIcon } from 'lucide-svelte';
	import moment from 'moment';
	import { onMount } from 'svelte';

	Notifier.init();

	const today = moment().format(ISODATEFORMAT);

	let allItems: ScheduledTransaction[] = $state([]);
	let filteredList: ScheduledTransaction[] = $state([]);
	let currentDate = null;
	let amounts: Money[] = $state([]);

	onMount(async () => {
		await loadData();

		await calculateAmounts();
	});

	function calculateAmounts() {
		let xacts = filteredList.map((scx) => scx.transaction);
		amounts = XactAugmenter.calculateXactAmounts(xacts as Xact[]);
	}

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

		// Leave date values only at the top of the group.
		sorted = removeRedundantDates(sorted);

		allItems = sorted;
		filteredList = sorted;
	}

	async function onFabClicked() {
		// reset any cached values
		//   mainStore.newScheduledTx()
		//   mainStore.newTx()
		//   goto("/scheduled-xact-editor")

		Notifier.neutral('not implemented');
	}

	function onItemClicked() {
		// todo: show details page
	}

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

	/**
	 * Removes the dates from the rows, leaving only the first record with the date.
	 * This is used when displaying the list, to separate date groups.
	 * @param list
	 */
	function removeRedundantDates(list: ScheduledTransaction[]): ScheduledTransaction[] {
		let previousDate = null;

		for (let i = 0; i < list.length; i++) {
			let scx = list[i];
			console.debug('comparing', scx.nextDate, previousDate);

			if (scx.nextDate !== previousDate) {
				previousDate = scx.nextDate;
			} else {
				scx.nextDate = '';
			}
		}

		return list;
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Scheduled Transactions">
		{#snippet menuItems()}
			<ToolbarMenuItem Icon={PackageIcon} text="Backup" targetNav="/export/scheduled" />
			<ToolbarMenuItem Icon={PackageOpenIcon} text="Restore" targetNav="/restore/scheduled" />
			<ToolbarMenuItem Icon={CalendarIcon} text="Calendar" />
		{/snippet}
	</Toolbar>
	<!-- search toolbar -->
	<SearchToolbar focus {onSearch} />

	<Fab onclick={onFabClicked} Icon={PlusIcon} />

	<section class="grow overflow-auto p-1">
		{#if filteredList.length === 0}
			<p>No scheduled transactions found</p>
		{:else}
			<!-- list -->
			<div class="space-y-1">
				{#each filteredList as scx, i}
					{#if scx.nextDate}
						<div class={`flex flex-row justify-center border-t border-tertiary-200/15 py-1 ${getDateColour(scx.nextDate)}`}>
							<CalendarIcon />
							<time class="ml-2">{scx.nextDate}</time>
						</div>
					{/if}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="flex flex-row" onclick={onItemClicked}>
						<div class="grow">
							<data>{scx.transaction?.payee}</data>
							<div class="text-sm opacity-60">
								{scx.remarks?.split('\n')[0]}
							</div>
						</div>
						<data class={`${getMoneyColour(amounts[i])}`}>
							{amounts[i]?.amount}&nbsp;{amounts[i]?.currency}
						</data>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</article>
