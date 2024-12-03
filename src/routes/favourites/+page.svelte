<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import type { Account } from '$lib/data/model';
	import { AccountService } from '$lib/services/accountsService';
	import appService from '$lib/services/appService';
	import { onMount } from 'svelte';

	let accounts: Account[] = $state([]);

	onMount(async () => {
		// todo: handle account selection

		await loadData();
	});

	async function loadData() {
		// load from settings
		accounts = await appService.loadFavouriteAccounts();

		let defaultCurrency = await appService.getDefaultCurrency();
		// get account balances
		const acctSvc = new AccountService();
		accounts.forEach((account) => {
			account.balance = acctSvc.getAccountBalance(account, defaultCurrency);
		});
	}
</script>

<Toolbar title="Favourites">
	{#snippet menuItems()}
		<ToolbarMenuItem text="Add" />
		<ToolbarMenuItem text="Delete" />
		<ToolbarMenuItem text="Delete All" />
		<ToolbarMenuItem text="Reorder" />
	{/snippet}
</Toolbar>

<section class="p-1">
	{#if accounts.length === 0}
		<p>No favourite accounts set</p>
	{:else}
		{#each accounts as account}
			<div class="flex flex-row">
				<data class="grow">
					{account.name} --
				</data>
				<data>
					{account.balance?.amount} {account.balance?.currency}
				</data>
			</div>
		{/each}
	{/if}
</section>
