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
			<div class="table-container">
				<table class="table table-hover">
					<tbody>
						{#each accounts as account}
							<tr>
								<td class="!py-2">{account?.name}</td>
								<td class="!py-2" style="text-align: end;">
									{getBalance(account).amount}
									{getBalance(account).currency}
								</td>
								<!-- ?.Balances?.FirstOrDefault() -->
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/snippet}
</HomeCardTemplate>
