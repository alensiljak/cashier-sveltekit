<script lang="ts">
	import { CalendarClockIcon } from 'lucide-svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import { goto } from '$app/navigation';
	import type { Money, ScheduledTransaction, Xact } from '$lib/data/model';
	import { onMount } from 'svelte';
	import db from '$lib/data/db';
	import moment from 'moment';
	import { ISODATEFORMAT } from '$lib/constants';
	import { XactAugmenter } from '$lib/utils/xactAugmenter';
	import { getAmountColour, getXactAmountColour } from '$lib/utils/formatter';

	let today: string = $state('');
	let scxs: ScheduledTransaction[] = $state([]);
	let amounts: Money[] = $state([])

	onMount(async () => {
		today = moment().format(ISODATEFORMAT);

		await loadData();

		calculateAmounts()
	});

	function calculateAmounts() {
		let xacts = scxs.map((scx) => scx.transaction)
		amounts = XactAugmenter.calculateXactAmounts(xacts as Xact[])
	}

	function getDateColour(date: string) {
		if(date < today) {
			return 'text-secondary-500'
		}
		if(date === today) {
			return 'text-tertiary-500'
		}
		if(date > today) {
			return 'text-primary-500'
		}
	}

	async function loadData() {
		scxs = await db.scheduled.orderBy('nextDate').limit(5).toArray();
	}

	async function onClick() {
		await goto('/scheduled-xacts');
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
			<div class="text-sm space-y-1">
				{#each scxs as scx, index}
				<!-- row -->
				<div class="flex flex-row space-x-2">
					<time class={`${getDateColour(scx.nextDate)}`}>
						{scx.nextDate}
					</time>
					<data class="grow">
						{scx.transaction?.payee}
					</data>
					<data class={`${getAmountColour(amounts[index]?.amount)}`}>
						{amounts[index]?.amount} {amounts[index]?.currency}
					</data>
				</div>
				{/each}
			</div>
		{/if}
	{/snippet}
	{#snippet footer()}
	<center>
		<a href="/export/journal" class="variant-outline-warning btn uppercase">
			<span></span>
			<span>Export</span>
		</a>
	</center>
{/snippet}

</HomeCardTemplate>
