<script lang="ts">
	import { CalendarClockIcon } from 'lucide-svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import { goto } from '$app/navigation';
	import type { ScheduledTransaction } from '$lib/data/model';
	import { onMount } from 'svelte';
	import db from '$lib/data/db';
	import moment from 'moment';
	import { ISODATEFORMAT } from '$lib/constants';
	import { XactAugmenter } from '$lib/utils/xactAugmenter';

	let scxs: ScheduledTransaction[] = $state([]);
	let today: string = $state('');

	onMount(async () => {
		today = moment().format(ISODATEFORMAT);

		await loadData();
	});

	function calculateAmounts() {
		let xacts = scxs.map((scx) => scx.transaction)
		let augmenter = new XactAugmenter()
		// augmenter.
	}

	function getDateColour(date: string) {
		if(date < today) {
			return 'text-tertiary-500'
		}
		if(date === today) {
			return 'text-secondary-500'
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
			<div>
				{#each scxs as scx}
				<div class="flex flex-row space-x-2">
					<span>{scx.nextDate}</span>
					<span class="grow">
						payee</span>
					<span>
						amount</span>
				</div>
				{/each}
			</div>
		{/if}
	{/snippet}
</HomeCardTemplate>
