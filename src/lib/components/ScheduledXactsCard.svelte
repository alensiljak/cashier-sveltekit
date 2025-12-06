<script lang="ts">
	import { CalendarClockIcon, FileUpIcon } from '@lucide/svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import { goto } from '$app/navigation';
	import type { Money, ScheduledTransaction, Xact } from '$lib/data/model';
	import { onMount } from 'svelte';
	import db from '$lib/data/db';
	import moment from 'moment';
	import { ISODATEFORMAT } from '$lib/constants';
	import { XactAugmenter } from '$lib/utils/xactAugmenter';
	import { formatAmount, getAmountColour, getXactAmountColour } from '$lib/utils/formatter';
	import { preventDefault } from 'svelte/legacy';

	let today: string = $state('');
	let scxs: ScheduledTransaction[] = $state([]);
	let amounts: Money[] = $state([]);

	onMount(async () => {
		today = moment().format(ISODATEFORMAT);

		await loadData();

		calculateAmounts();
	});

	function calculateAmounts() {
		let xacts = scxs.map((scx) => scx.transaction);
		amounts = XactAugmenter.calculateXactAmounts(xacts as Xact[]);
	}

	function getDateColour(date: string) {
		if (date < today) {
			return 'text-secondary';
		}
		if (date === today) {
			return 'text-base';
		}
		if (date > today) {
			return 'text-primary';
		}
	}

	async function loadData() {
		scxs = await db.scheduled.orderBy('nextDate').limit(5).toArray();
	}

	async function onClick() {
		await goto('/scheduled-xacts');
	}

	async function onExportClick(e: Event) {
		e.stopPropagation();
		await goto('/export/scheduled');
	}
</script>

<HomeCardTemplate onclick={onClick}>
	{#snippet icon()}
		<CalendarClockIcon />
	{/snippet}
	{#snippet title()}
		Upcoming Transactions
	{/snippet}
	{#snippet content()}
		{#if scxs.length === 0}
			<p>There are no scheduled transactions</p>
		{:else}
			<!-- list container -->
			<div class="space-y-1 text-sm">
				{#each scxs as scx, index}
					<!-- row -->
					<div class="flex flex-row space-x-2">
						<time class={`${getDateColour(scx.nextDate)}`}>
							{scx.nextDate}
						</time>
						<data class="grow">
							{scx.transaction?.payee}
						</data>
						<data class={`${getAmountColour(amounts[index]?.quantity)}`}>
							{formatAmount(amounts[index]?.quantity)}
							{amounts[index]?.currency}
						</data>
					</div>
				{/each}
			</div>
		{/if}
	{/snippet}
	{#snippet footer()}
		<!-- <center>
		<button type="button" class="btn btn-outline btn-warning uppercase" onclick={onExportClick}>
			<FileUpIcon />
			<span>Export</span>
		</button>
	</center> -->
	{/snippet}
</HomeCardTemplate>
