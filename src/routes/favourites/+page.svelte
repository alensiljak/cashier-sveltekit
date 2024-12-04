<script lang="ts">
	import { goto } from '$app/navigation';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import db from '$lib/data/db';
	import { selectionMetadata } from '$lib/data/mainStore';
	import type { Account, Money } from '$lib/data/model';
	import { SelectionType } from '$lib/enums';
	import { AccountService } from '$lib/services/accountsService';
	import appService from '$lib/services/appService';
	import { SelectionModeMetadata, SettingKeys, settings } from '$lib/settings';
	import { formatAmount, getMoneyColour } from '$lib/utils/formatter';
	import Notifier from '$lib/utils/notifier';
	import { PlusIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';

	Notifier.init();

	let accounts: Account[] = $state([]);
	let refreshKey = $state(0);

	onMount(async () => {
		await handleAccountSelection();

		await loadData();
	});

	async function addAccount(accountName: string) {
		const favNames: string[] = await settings.get(SettingKeys.favouriteAccounts);
		if (favNames.includes(accountName)) {
			Notifier.warn('The account is already present');
			return;
		} else {
			favNames.push(accountName);
			await settings.set(SettingKeys.favouriteAccounts, favNames);
			Notifier.success('Account added');
		}
	}

	/**
	 * Handle account selection after Add new account.
	 */
	async function handleAccountSelection() {
		if (!$selectionMetadata || !$selectionMetadata.selectedId) return;
		if ($selectionMetadata.selectionType !== SelectionType.ACCOUNT) return;

		let account = await db.accounts.get($selectionMetadata.selectedId);
		if (!account) {
			throw new Error('Account not found');
		}

		await addAccount(account.name);

		selectionMetadata.set(undefined);
	}

	async function loadData() {
		// load from settings
		accounts = await appService.loadFavouriteAccounts();

		let defaultCurrency = await appService.getDefaultCurrency();
		// get account balances
		const acctSvc = new AccountService();
		accounts.forEach((account) => {
			account.balance = acctSvc.getAccountBalance(account, defaultCurrency);
		});

		// todo: add local Xacts to the balance.

		// refresh the UI.
		refreshKey += 1;
	}

	async function onAddClicked() {
		$selectionMetadata = new SelectionModeMetadata();
		$selectionMetadata.selectionType = SelectionType.ACCOUNT;

		await goto('/accounts');
	}
</script>

<article class="h-screen grid grid-rows-[auto-1fr]">
	<Toolbar title="Favourites">
		{#snippet menuItems()}
			<ToolbarMenuItem text="Add" onclick={onAddClicked} />
			<ToolbarMenuItem text="Delete" />
			<ToolbarMenuItem text="Delete All" />
			<ToolbarMenuItem text="Reorder" />
		{/snippet}
	</Toolbar>

	<Fab Icon={PlusIcon} onclick={onAddClicked} />

	<section class="p-1 grow overflow-auto">
		{#if accounts.length === 0}
			<p>No favourite accounts set</p>
		{:else}
			<!-- list -->
			<div class="space-y-2">
				{#each accounts as account}
					<!-- row -->
					<div class="flex flex-row">
						<data class="mr-1 grow">
							{account.name}
						</data>
						{#key refreshKey}
							<data class={`text-end ${getMoneyColour(account.balance as Money)}`}>
								{formatAmount(account.balance?.amount as number)}&nbsp;{account.balance?.currency}
							</data>
						{/key}
					</div>
				{/each}
			</div>
		{/if}
	</section>
</article>
