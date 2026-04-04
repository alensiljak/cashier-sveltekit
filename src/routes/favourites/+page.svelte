<script lang="ts">
	import { goto } from '$app/navigation';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { selectionMetadata } from '$lib/data/mainStore';
	import { Account, Money } from '$lib/data/model';
	import { SelectionType } from '$lib/enums';
	import ledgerService from '$lib/services/ledgerService';
	import appService from '$lib/services/appService';
	import { SelectionModeMetadata, SettingKeys, settings } from '$lib/settings';
	import { formatAmount, getMoneyColour } from '$lib/utils/formatter';
	import { getBarWidth } from '$lib/utils/barWidthCalculator';
	import Notifier from '$lib/utils/notifier';
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
			const quantities = accounts
				.map((account) => Math.abs(account.balance?.quantity as number))
				.filter((q) => !isNaN(q) && q > 0);
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

	function closeModal() {
		isDeleteAllConfirmationOpen = false;
	}

	async function addAccount(accountName: string) {
		let favNames = await settings.get(SettingKeys.favouriteAccounts) as string[] ?? [];

		if (favNames.includes(accountName)) {
			Notifier.info('The account is already present');
			return;
		} else {
			favNames.push(accountName);
			await settings.set(SettingKeys.favouriteAccounts, favNames);
			Notifier.success('Account added');
		}
	}

	async function handleAccountSelection() {
		if (!$selectionMetadata || !$selectionMetadata.selectedId) return;
		if ($selectionMetadata.selectionType !== SelectionType.ACCOUNT) return;

		// The selectedId is the account name (string key).
		await addAccount($selectionMetadata.selectedId as string);

		selectionMetadata.set(undefined);
	}

	function isGrayedOut(account: Account) {
		return account.exists === false;
	}

	/**
	 * Query account balances from the ParsedLedger via BQL.
	 */
	function queryFavouriteBalances(favNames: string[]): Map<string, Account> {
		const result = new Map<string, Account>();
		if (favNames.length === 0) return result;

		// Build the WHERE IN clause.
		const quotedNames = favNames.map((n) => `'${n}'`).join(', ');
		const bql = `SELECT account, sum(position) AS balance WHERE account IN (${quotedNames})`;

		const queryResult = ledgerService.query(bql);
		if (queryResult.errors.length > 0) {
			console.warn('BQL query errors:', queryResult.errors);
			return result;
		}

		const accountIdx = queryResult.columns.indexOf('account');
		const balanceIdx = queryResult.columns.indexOf('balance');

		for (const row of queryResult.rows) {
			const name: string = row[accountIdx];
			const account = new Account(name);

			if (balanceIdx !== -1) {
				const cell = row[balanceIdx];
				const balances = extractBalances(cell);
				if (Object.keys(balances).length > 0) {
					account.balances = balances;
				}
			}

			result.set(name, account);
		}

		return result;
	}

	/**
	 * Extract currency→amount pairs from a BQL position cell.
	 */
	function extractBalances(cell: any): Record<string, number> {
		const balances: Record<string, number> = {};
		if (!cell || typeof cell !== 'object') return balances;

		if (Array.isArray(cell.positions)) {
			for (const pos of cell.positions) {
				if (pos?.units?.currency && pos.units.number != null) {
					balances[pos.units.currency] = parseFloat(pos.units.number);
				}
			}
			return balances;
		}
		if (cell.units?.currency && cell.units.number != null) {
			balances[cell.units.currency] = parseFloat(cell.units.number);
			return balances;
		}
		if (cell.currency && cell.number != null) {
			balances[cell.currency] = parseFloat(cell.number);
		}
		return balances;
	}

	async function loadData() {
		const favNames: string[] = (await settings.get(SettingKeys.favouriteAccounts)) ?? [];
		if (favNames.length === 0) {
			accounts = [];
			return;
		}

		const defaultCurrency = await appService.getDefaultCurrency();

		// Query balances from the WASM ParsedLedger.
		const balanceMap = queryFavouriteBalances(favNames);

		// Build the accounts list preserving the favourites order.
		accounts = favNames.map((name) => {
			const found = balanceMap.get(name);
			if (found) {
				// Set the display balance from the balances map.
				const money = new Money();
				money.currency = defaultCurrency;
				if (found.balances) {
					if (found.balances[defaultCurrency] != null) {
						money.quantity = found.balances[defaultCurrency];
						money.currency = defaultCurrency;
					} else {
						const firstCurrency = Object.keys(found.balances)[0];
						if (firstCurrency) {
							money.quantity = found.balances[firstCurrency];
							money.currency = firstCurrency;
						}
					}
				}
				found.balance = money;
				return found;
			} else {
				// Account not found in ledger — mark as non-existent.
				const account = new Account(name);
				account.exists = false;
				account.balance = new Money();
				account.balance.currency = defaultCurrency;
				return account;
			}
		});

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
				{#each accounts as account (account)}
					<div class="flex w-full flex-col px-0.5">
						<!-- row -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class={`border-base-content/15 hover:bg-base-100 hover:bg-opacity-50 flex cursor-pointer flex-row
										border-b py-1 ${isGrayedOut(account) ? 'text-base-content text-opacity-50' : ''}`}
							onclick={() => onAccountClick(account.name)}
						>
							<div class="mr-1 flex grow flex-col">
								<small>{account.getParentName()}</small>
								<data class="ml-4">{account.getAccountName()}</data>
							</div>
							{#key refreshKey}
								<data class={`content-end text-end ${getMoneyColour(account.balance as Money)}`}>
									{formatAmount(account.balance?.quantity as number)}
									{account.balance?.currency}
								</data>
							{/key}
						</div>
						{#key refreshKey}
							<div
								class="h-1"
								style="width: {getBarWidth(
									account.balance?.quantity as number,
									minBalance,
									maxBalance
								)}%; background-color: {(account.balance?.quantity as number) >= 0
									? 'green'
									: 'red'};"
							></div>
						{/key}
					</div>
				{/each}
			</div>
		{/if}
	</section>
</article>

<!-- "Delete All" dialog -->
<input type="checkbox" id="delete-all-fav-confirmation-modal" class="modal-toggle"
    bind:checked={isDeleteAllConfirmationOpen} />
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Confirm Delete</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">Do you want to clear the favourite accounts list?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary text-primary-content"
				onclick={onDeleteAllConfirmed}>OK</button
			>
		</footer>
	</div>
</dialog>
