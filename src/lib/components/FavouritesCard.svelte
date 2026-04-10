<script lang="ts">
	import { StarIcon } from '@lucide/svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import { goto } from '$app/navigation';
	import { Account, Money } from '$lib/data/model';
	import appService from '$lib/services/appService';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import Notifier from '$lib/utils/notifier';
	import { formatAmount, getAmountColour } from '$lib/utils/formatter';
	import { getBarWidth } from '$lib/utils/barWidthCalculator';
	import { SettingKeys, settings } from '$lib/settings';

	Notifier.init();

	let accounts: Array<Account> = $state([]);

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

	let maxBalance: number = $state(0);
	let minBalance: number = $state(0);

	const lsVersion = fullLedgerService.version;
	const isReloading = fullLedgerService.isReloading;

	let balancesLoaded = $state(false);

	// Immediately show account names with placeholders, then load balances.
	$effect(() => {
		const _v = $lsVersion;
		balancesLoaded = false;
		showPlaceholders();
		loadData();
	});

	async function showPlaceholders() {
		const favNames: string[] =
			((await settings.get<string[]>(SettingKeys.favouriteAccounts)) ?? []).slice(0, 5);
		if (favNames.length === 0) return;

		// Only set placeholders if balances haven't loaded yet.
		if (!balancesLoaded) {
			accounts = favNames.map((name) => {
				const account = new Account(name);
				account.balance = new Money();
				account.balance.currency = '---';
				account.balance.quantity = 0;
				return account;
			});
		}
	}

	async function queryFavouriteBalances(favNames: string[]): Promise<Map<string, Account>> {
		const result = new Map<string, Account>();
		if (favNames.length === 0) return result;

		await fullLedgerService.ensureLoaded();

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
		try {
			const favNames: string[] =
				((await settings.get<string[]>(SettingKeys.favouriteAccounts)) ?? [])
					.slice(0, 5);
			if (favNames.length === 0) {
				accounts = [];
				return;
			}

			const defaultCurrency = await appService.getDefaultCurrency();
			const balanceMap = await queryFavouriteBalances(favNames);

			accounts = favNames.map((name) => {
				const found = balanceMap.get(name);
				if (found) {
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
					const account = new Account(name);
					account.exists = false;
					account.balance = new Money();
					account.balance.currency = defaultCurrency;
					return account;
				}
			});
			balancesLoaded = true;
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
		{#if $isReloading}<span class="loading loading-spinner loading-xs ml-2 opacity-70"></span>{/if}
	{/snippet}
	{#snippet content()}
		{#if !accounts}
			<p>There are no favourite accounts defined</p>
		{:else}
			{#each accounts as account: Account (account.name)}
				<div class="bg-base-200 flex w-full flex-col px-0.5 text-base">
					<div class="border-base-content/15 my-0.25 flex flex-row border-b py-0.5">
						<div class={`cell grow ${isGrayedOut(account) ? 'text-base-content text-opacity-50' : ''}`}>
							{account?.name}
						</div>
						<data class={`text-right ${balancesLoaded ? getAmountColour(account.balance?.quantity as number) : 'text-base-content/30'}`}>
							{#if balancesLoaded}
								{formatAmount(account.balance?.quantity as number)}
								{account.balance?.currency}
							{:else}
								···
							{/if}
						</data>
					</div>
					{#if balancesLoaded}
						<div
							class="h-1"
							style="width: {getBarWidth(
								account.balance?.quantity as number,
								minBalance,
								maxBalance
							)}%; background-color: {(account.balance?.quantity as number) >= 0 ? 'green' : 'red'};"
						></div>
					{/if}
				</div>
			{/each}
		{/if}
	{/snippet}
</HomeCardTemplate>
