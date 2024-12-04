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
	import { getModalStore, type ModalSettings } from '@skeletonlabs/skeleton';
	import { ArrowUpDownIcon, PlusCircleIcon, PlusIcon, Trash2Icon, TrashIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';

	const modalStore = getModalStore();
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

	async function onDeleteClicked() {
		await goto('/favourites-delete');
	}

	function onDeleteAllClicked() {
		// confirm dialog
		const modal: ModalSettings = {
			type: 'confirm',
			// Data
			title: 'Confirm Delete',
			body: 'Do you want to clear the favourite accounts list?',
			response: async (r: boolean) => {
				if (r) {
					await settings.set(SettingKeys.favouriteAccounts, []);
					await loadData();
				}
			}
		};
		modalStore.trigger(modal);
	}

	async function onReorderClick() {
		await goto('/favourites-reorder');
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Favourites">
		{#snippet menuItems()}
			<ToolbarMenuItem text="Add" Icon={PlusCircleIcon} onclick={onAddClicked} />
			<ToolbarMenuItem text="Delete" Icon={TrashIcon} onclick={onDeleteClicked} />
			<ToolbarMenuItem text="Delete All" Icon={Trash2Icon} onclick={onDeleteAllClicked} />
			<ToolbarMenuItem text="Reorder" Icon={ArrowUpDownIcon} onclick={onReorderClick} />
		{/snippet}
	</Toolbar>

	<Fab Icon={PlusIcon} onclick={onAddClicked} />

	<section class="grow overflow-auto p-1">
		{#if accounts.length === 0}
			<p>No favourite accounts set</p>
		{:else}
			<!-- list -->
			<div>
				{#each accounts as account}
					<!-- row -->
					<div class="py-1 flex flex-row border-b border-tertiary-200/15">
						<div class="mr-1 flex grow flex-col">
							<small>{account.getParentName()}</small>
							<data class="ml-4">{account.getAccountName()}</data>
						</div>
						{#key refreshKey}
							<data class={`content-end text-end ${getMoneyColour(account.balance as Money)}`}>
								{formatAmount(account.balance?.amount as number)}&nbsp;{account.balance?.currency}
							</data>
						{/key}
					</div>
				{/each}
			</div>
		{/if}
	</section>
</article>
