<script lang="ts">
	import { StarIcon } from 'lucide-svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import { goto } from '$app/navigation';
	import type { Account } from '$lib/data/model';
	import { onMount } from 'svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import { TransactionAugmenter } from '$lib/utils/transactionAugmenter';
	import appService from '$lib/services/appService';
	import Notifier from '$lib/utils/notifier';
	import { AccountService } from '$lib/services/accountsService';

	Notifier.init();
	const accountService = new AccountService();

	let defaultCurrency: string;
	let accounts: Array<Account> = $state([]);

	onMount(async () => {
		await loadData();
	});

	function getBalance(account: Account) {
		return accountService.getAccountBalance(account, defaultCurrency);
	}

	async function loadData() {
		defaultCurrency = await settings.get(SettingKeys.currency);

		try {
			let favArray = await appService.loadFavouriteAccounts();
			if (!favArray) {
				console.log('no favourite accounts selected yet');
				return;
			}

			// Use only the top 5 records.
			favArray = favArray.slice(0, 5);

			// adjust the balance
			const augmenter = new TransactionAugmenter();
			favArray = await augmenter.adjustAccountBalances(favArray);

			accounts = favArray;
		} catch (error: any) {
			console.error(error);
			Notifier.error(error.message);
		}
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
			{#each accounts as account}
				<div class="flex w-full flex-col bg-surface-900 px-0.5 text-sm">
					<div class="my-0.25 flex flex-row border-b border-tertiary-200/15 py-1">
						<div class="cell grow">
							{account?.name}
						</div>
						<div class="text-right">
							{getBalance(account).amount}
							{getBalance(account).currency}
						</div>
					</div>
				</div>
			{/each}
		{/if}
	{/snippet}
</HomeCardTemplate>
