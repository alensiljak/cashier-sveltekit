<script lang="ts">
	import { goto } from '$app/navigation';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import db from '$lib/data/db';
	import { selectionMetadata } from '$lib/data/mainStore';
	import type { Account, Money } from '$lib/data/model';
	import { SelectionType } from '$lib/enums';
	import * as AccountService from '$lib/services/accountsService';
	import appService from '$lib/services/appService';
	import { SelectionModeMetadata, SettingKeys, settings } from '$lib/settings';
	import { formatAmount, getMoneyColour } from '$lib/utils/formatter';
	import { getBarWidth } from '$lib/utils/barWidthCalculator';
	import Notifier from '$lib/utils/notifier';
	import { Modal } from '@skeletonlabs/skeleton-svelte';
	import { ArrowUpDownIcon, PlusCircleIcon, PlusIcon, Trash2Icon, TrashIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	Notifier.init();
	
	let isDeleteAllConfirmationOpen = $state(false);

	let accounts: Account[] = $state([]);
	let refreshKey = $state(0);

	let maxBalance: number = $state(0);
	let minBalance: number = $state(0);

	$effect(() => {
		if (accounts.length > 0) {
			const quantities = accounts.map(account => Math.abs(account.balance?.quantity as number)).filter(q => !isNaN(q) && q > 0);
			if (quantities.length > 0) {
				maxBalance = Math.max(...quantities);
				minBalance = Math.min(...quantities);
			} else {
				maxBalance = 0;
				minBalance = 0;
			}
		}
	});

	onMount(async () => {
		await handleAccountSelection();

		await loadData();
	});

	/**
	 * Close all dialogs.
	 */
	function closeModal() {
		isDeleteAllConfirmationOpen = false;
	}

	async function addAccount(accountName: string) {
		const favNames: string[] = await settings.get(SettingKeys.favouriteAccounts);
		if (favNames.includes(accountName)) {
			Notifier.info('The account is already present');
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

	function isGrayedOut(account: Account) {
		return account.exists === false;
	}

	async function loadData() {
		// load from settings
		accounts = await appService.loadFavouriteAccounts();

		let defaultCurrency = await appService.getDefaultCurrency();
		// get account balances
		accounts.forEach((account) => {
			account.balance = AccountService.getAccountBalance(account, defaultCurrency);
		});

		// Explicitly re-assign accounts to trigger reactivity
		accounts = [...accounts];

		// todo: add local Xacts to the balance.

		// refresh the UI.
		refreshKey += 1;
	}

	async function onAccountClick(accountName?: string) {
		goto('/account-xacts/' + accountName);
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
		isDeleteAllConfirmationOpen = true;
	}

	async function onDeleteAllConfirmed() {
		closeModal();
		
		await settings.set(SettingKeys.favouriteAccounts, []);
		await loadData();
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
					<div class="flex w-full flex-col px-0.5 text-sm">
						<!-- row -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class={`flex cursor-pointer flex-row border-b border-tertiary-200/15
										py-1 hover:bg-surface-600 ${isGrayedOut(account) ? 'text-surface-300' : ''}`}
							onclick={() => onAccountClick(account.name)}
						>
							<div class="mr-1 flex grow flex-col">
								<small>{account.getParentName()}</small>
								<data class="ml-4">{account.getAccountName()}</data>
							</div>
							{#key refreshKey}
								<data class={`content-end text-end ${getMoneyColour(account.balance as Money)}`}>
									{formatAmount(account.balance?.quantity as number)} {account.balance?.currency}
								</data>
							{/key}
						</div>
							{#key refreshKey}
						<div
							class="h-1"
							style="width: {getBarWidth(account.balance?.quantity as number, minBalance, maxBalance)}%; background-color: {account.balance?.quantity as number >= 0 ? 'green' : 'red'};"
						></div>
						{/key}
					</div>
				{/each}
			</div>
		{/if}
	</section>
</article>

<!-- "Delete All" dialog -->
<Modal
	open={isDeleteAllConfirmationOpen}
	triggerBase="hidden"
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-(--breakpoint-sm)"
	backdropClasses="backdrop-blur-xs"
>
	{#snippet trigger()}Open Modal{/snippet}
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h4">Confirm Delete</h2>
		</header>
		<article>
			<p class="opacity-60">
				Do you want to clear the favourite accounts list?
			</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="preset-tonal btn" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn-primary preset-filled-primary-500 btn text-tertiary-500"
				onclick={onDeleteAllConfirmed}>OK</button
			>
		</footer>
	{/snippet}
</Modal>
