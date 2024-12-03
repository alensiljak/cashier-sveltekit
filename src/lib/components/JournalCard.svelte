<script lang="ts">
	import { FileUpIcon, ScrollIcon } from 'lucide-svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import db from '$lib/data/db';
	import { Money, type Xact } from '$lib/data/model';
	import { XactAugmenter } from '$lib/utils/xactAugmenter';
	import Notifier from '$lib/utils/notifier';
	import { getXactAmountColour } from '$lib/utils/formatter';

	let xacts: Xact[] = $state([]);
	let xactBalances: Money[] = $state([]);

	onMount(async () => {
		await loadData();
	});

	/**
	 * Return the colour to use for the amount.
	 * @param i Index of the Xact in the list.
	 */
	function getXactColour(i: number) {
		if(!xactBalances[i].amount) return '';

		const xact = xacts[i]
		const balance = xactBalances[i]

		const colour = getXactAmountColour(xact, balance);

		return colour
	}

	async function loadData() {
		xacts = await db.xacts.orderBy('date').reverse().limit(5).toArray();

		try {
			const amounts = XactAugmenter.calculateXactAmounts(xacts);
			xactBalances.push(...amounts);
		} catch (error: any) {
			console.error(error);
			Notifier.error(error.message);
		}
	}

	async function onClick() {
		await goto('/journal');
	}
</script>

<HomeCardTemplate onclick={onClick}>
	{#snippet icon()}
		<ScrollIcon />
	{/snippet}
	{#snippet title()}
		Device Journal
	{/snippet}
	{#snippet content()}
		{#if xacts.length == 0}
			<p>The device journal is empty</p>
		{:else}
			{#each xacts as xact, index}
				<div class="flex space-x-2 border-b border-tertiary-200/15 text-sm">
					<time class="opacity-60">
						{xact.date}
					</time>
					<div class="grow">
						{xact.payee}
					</div>
					<div class={`${getXactColour(index)}`}>
						{ xactBalances[index].amount } { xactBalances[index].currency }
					</div>
				</div>
			{/each}
		{/if}
	{/snippet}
	{#snippet footer()}
		<center>
			<a href="/export/journal" class="variant-outline-warning btn uppercase">
				<span><FileUpIcon /></span>
				<span>Export</span>
			</a>
		</center>
	{/snippet}
</HomeCardTemplate>
