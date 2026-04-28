<script lang="ts">
	import { goto } from '$app/navigation';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { selectionMetadata } from '$lib/data/mainStore';
	import { Account, Money } from '$lib/data/model';
	import { SelectionType } from '$lib/enums';
	import appService from '$lib/services/appService';
	import { SelectionModeMetadata, SettingKeys, settings } from '$lib/settings';
	import AccountRow from '$lib/components/AccountRow.svelte';
	import Notifier from '$lib/utils/notifier';
	import { ArrowUpDownIcon, PlusCircleIcon, PlusIcon, Trash2Icon, TrashIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';

	Notifier.init();

	let isDeleteAllConfirmationOpen = $state(false);

	let accounts: Account[] = $state([]);

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


	/**
	 * Query account balances from the ParsedLedger via BQL.
	 */
	async function queryFavouriteBalances(favNames: string[]): Promise<Map<string, Account>> {
		const result = new Map<string, Account>();
		if (favNames.length === 0) return result;

		await fullLedgerService.ensureLoaded();

		// Build the WHERE IN clause.
		const quotedNames = favNames.map((n) => `'${n}'`).join(', ');
		const bql = `SELECT account, sum(position) AS balance WHERE account IN (${quotedNames})`;

		const queryResult = await fullLedgerService.query(bql);
		if (queryResult.errors.length > 0) {
			console.warn('BQL query errors:', queryResult.errors);
		}

		const accountIdx = queryResult.columns.indexOf('account');
		const balanceIdx = queryResult.columns.indexOf('balance');

		for (const row of queryResult.rows as any[][]) {
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

		// Query balances via the full ledger worker.
		const balanceMap = await queryFavouriteBalances(favNames);

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
	}

	async function onAccountClick(accountName?: string) {
		goto('/accounts/account-xacts/' + accountName);
	}

	async function onAddClicked() {
		$selectionMetadata = new SelectionModeMetadata();
		$selectionMetadata.selectionType = SelectionType.ACCOUNT;

		await goto('/accounts');
	}

	async function onDeleteClicked() {
		await goto('/favourites/delete');
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
		await goto('/favourites/reorder');
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

	<section class="grow p-1">
		{#if accounts.length === 0}
			<p>No favourite accounts set</p>
		{:else}
			<!-- list -->
			<div>
				{#each accounts as account (account.name)}
					<AccountRow
						{account}
						balancesLoaded={true}
						{minBalance}
						{maxBalance}
						onclick={onAccountClick}
					/>
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
