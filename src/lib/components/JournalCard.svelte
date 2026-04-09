<script lang="ts">
	import { FileUpIcon, ScrollIcon } from '@lucide/svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import { goto } from '$app/navigation';
	import { Money, type Xact } from '$lib/data/model';
	import { XactAugmenter } from '$lib/utils/xactAugmenter';
	import Notifier from '$lib/utils/notifier';
	import { formatAmount, getReadableDate, getXactAmountColour } from '$lib/utils/formatter';
	import fullLedgerService from '$lib/services/fullLedgerService';
	import workerLedger from '$lib/services/ledgerWorkerClient';

	Notifier.init();

	let xacts: Xact[] = $state([]);
	let xactBalances: Money[] = $state([]);

	const lsVersion = fullLedgerService.version;
	const isReloading = workerLedger.isReloading;

	$effect(() => {
		const _v = $lsVersion;
		loadData();
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
		const all = fullLedgerService.getXacts();
		// Newest first, limited to 5
		xacts = all.slice().reverse().slice(0, 5);
		xactBalances = [];

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
		{#if $isReloading}<span class="loading loading-spinner loading-xs ml-2 opacity-70"></span>{/if}
	{/snippet}
	{#snippet content()}
		{#if xacts.length == 0}
			<p>The device journal is empty</p>
		{:else}
			<div class="container space-y-1 text-base">
				{#each xacts as xact, index (index)}
					<div class="border-base-content/15 flex space-x-2 border-b">
						<time class="opacity-60">
							{getReadableDate(xact.date)}
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
				class="btn btn-outline btn-warning uppercase rounded"
				onclick={onExportClick}
			>
				<FileUpIcon />
				<span>Export</span>
			</button>
		</center>
	{/snippet}
</HomeCardTemplate>
