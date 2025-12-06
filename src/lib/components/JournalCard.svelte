<script lang="ts">
	import { FileUpIcon, ScrollIcon } from '@lucide/svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import db from '$lib/data/db';
	import { Money, type Xact } from '$lib/data/model';
	import { XactAugmenter } from '$lib/utils/xactAugmenter';
	import Notifier from '$lib/utils/notifier';
	import { formatAmount, getXactAmountColour } from '$lib/utils/formatter';

	Notifier.init();

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
		if (!xactBalances[i].quantity) return '';

		const xact = xacts[i];
		const balance = xactBalances[i];

		const colour = getXactAmountColour(xact, balance);

		return colour;
	}

	async function loadData() {
		// Get the latest 5 transactions.
		xacts = await db.xacts.orderBy('date').reverse().limit(5).toArray();
		// now order from oldest to newest. <- no, keep the latest on top
		// xacts.reverse()

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

	async function onExportClick(e: Event) {
		e.stopPropagation();
		await goto('/export/journal');
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
			<div class="container space-y-1 text-sm">
				{#each xacts as xact, index}
					<div class="border-tertiary-200/15 flex space-x-2 border-b">
						<time class="opacity-60">
							{xact.date}
						</time>
						<div class="grow">
							{xact.payee}
						</div>
						<div class={`${getXactColour(index)}`}>
							{formatAmount(xactBalances[index].quantity)}
							{xactBalances[index].currency}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/snippet}
	{#snippet footer()}
		<center>
			<button
				type="button"
				class="btn btn-outline btn-warning uppercase"
				onclick={onExportClick}
			>
				<FileUpIcon />
				<span>Export</span>
			</button>
		</center>
	{/snippet}
</HomeCardTemplate>
