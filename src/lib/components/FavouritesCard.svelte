<script lang="ts">
	import { StarIcon } from '@lucide/svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import { goto } from '$app/navigation';
	import type { Account } from '$lib/data/model';
	import { onMount } from 'svelte';
	import { XactAugmenter } from '$lib/utils/xactAugmenter';
	import appService from '$lib/services/appService';
	import Notifier from '$lib/utils/notifier';
	import { getAccountBalance } from '$lib/services/accountsService';
	import { formatAmount, getAmountColour } from '$lib/utils/formatter';
	import { getBarWidth } from '$lib/utils/barWidthCalculator';

	Notifier.init();

	let defaultCurrency: string;
	let accounts: Array<Account> = $state([]);

	$effect(() => {
		if (accounts.length > 0) {
			maxBalance = Math.max(...accounts.map((account) => Math.abs(getBalance(account).quantity)));
			minBalance = Math.min(...accounts.map((account) => Math.abs(getBalance(account).quantity)));
		}
	});

	let maxBalance: number = $state(0);
	let minBalance: number = $state(0);

	onMount(async () => {
		await loadData();
	});

	function getBalance(account: Account) {
		return getAccountBalance(account, defaultCurrency);
	}

	async function loadData() {
		defaultCurrency = await appService.getDefaultCurrency();

		try {
			let favArray = await appService.loadFavouriteAccounts();
			if (!favArray) {
				console.log('no favourite accounts selected yet');
				return;
			}

			// Use only the top 5 records.
			favArray = favArray.slice(0, 5);

			// adjust the balance
			const augmenter = new XactAugmenter();
			favArray = await augmenter.adjustAccountBalances(favArray);

			accounts = favArray;
		} catch (error: any) {
			console.error(error);
			Notifier.error(error.message);
		}
	}

	function isGrayedOut(account: Account) {
		return account.exists === false;
	}

	async function onClick() {
		await goto('/favourites', { replaceState: false });
	}
</script>

<HomeCardTemplate onclick={onClick}>
	{#snippet icon()}
		<StarIcon />
	{/snippet}
	{#snippet title()}
		Favourites
	{/snippet}
	{#snippet content()}
		{#if !accounts}
			<p>There are no favourite accounts defined</p>
		{:else}
			{#each accounts as account: Account (account.name)}
				<div class="bg-surface-900 flex w-full flex-col px-0.5 text-sm">
					<div class="border-tertiary-200/15 my-0.25 flex flex-row border-b py-0.5">
						<div class={`cell grow ${isGrayedOut(account) ? 'text-surface-300' : ''}`}>
							{account?.name}
						</div>
						<data class={`text-right ${getAmountColour(getBalance(account).quantity)}`}>
							{formatAmount(getBalance(account).quantity)}
							{getBalance(account).currency}
						</data>
					</div>
					<div
						class="h-1"
						style="width: {getBarWidth(
							getBalance(account).quantity,
							minBalance,
							maxBalance
						)}%; background-color: {getBalance(account).quantity >= 0 ? 'green' : 'red'};"
					></div>
				</div>
			{/each}
		{/if}
	{/snippet}
</HomeCardTemplate>
