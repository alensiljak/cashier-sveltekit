<script lang="ts">
	import { Settings2Icon } from '@lucide/svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import AccountRow from './AccountRow.svelte';
	import { goto } from '$app/navigation';
	import { Account, Money } from '$lib/data/model';
	import type { AccountGroup } from '$lib/settings';
	import appService from '$lib/services/appService';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';

	type Props = {
		group: AccountGroup;
		index: number;
		onAccountClick?: (accountName: string) => void;
	};
	let { group, index, onAccountClick }: Props = $props();

	let accounts: Account[] = $state([]);
	let maxBalance = $state(0);
	let balancesLoaded = $state(false);

	const currencyTotals = $derived.by(() => {
		const totals: Record<string, number> = {};
		for (const account of accounts) {
			if (account.balances) {
				for (const [currency, amount] of Object.entries(account.balances)) {
					totals[currency] = (totals[currency] ?? 0) + amount;
				}
			}
		}
		return totals;
	});

	const lsVersion = fullLedgerService.version;
	const isReloading = fullLedgerService.isReloading;

	$effect(() => {
		const _v = $lsVersion;
		balancesLoaded = false;
		loadData();
	});

	$effect(() => {
		if (accounts.length > 0) {
			const quantities = accounts
				.map((a) => Math.abs(a.balance?.quantity as number))
				.filter((q) => !isNaN(q) && q > 0);
			maxBalance = quantities.length > 0 ? Math.max(...quantities) : 0;
		}
	});

	async function loadData() {
		if (group.accounts.length === 0) {
			accounts = [];
			return;
		}

		try {
			await fullLedgerService.ensureLoaded();
			const defaultCurrency = await appService.getDefaultCurrency();

			const quotedNames = group.accounts.map((n) => `'${n}'`).join(', ');
			const bql = `SELECT account, sum(position) AS balance WHERE account IN (${quotedNames})`;
			const queryResult = await fullLedgerService.query(bql);

			const accountIdx = queryResult.columns.indexOf('account');
			const balanceIdx = queryResult.columns.indexOf('balance');
			const balanceMap = new Map<string, Account>();

			for (const row of queryResult.rows as any[][]) {
				const name: string = row[accountIdx];
				const account = new Account(name);
				if (balanceIdx !== -1) {
					const balances = extractBalances(row[balanceIdx]);
					if (Object.keys(balances).length > 0) {
						account.balances = balances;
					}
				}
				balanceMap.set(name, account);
			}

			accounts = group.accounts.map((name) => {
				const found = balanceMap.get(name);
				if (found) {
					const money = new Money();
					money.currency = defaultCurrency;
					if (found.balances) {
						if (found.balances[defaultCurrency] != null) {
							money.quantity = found.balances[defaultCurrency];
							money.currency = defaultCurrency;
						} else {
							const first = Object.keys(found.balances)[0];
							if (first) {
								money.quantity = found.balances[first];
								money.currency = first;
							}
						}
					}
					found.balance = money;
					return found;
				} else {
					const a = new Account(name);
					a.exists = false;
					a.balance = new Money();
					a.balance.currency = defaultCurrency;
					return a;
				}
			});
			balancesLoaded = true;
		} catch (error: any) {
			console.error(error);
		}
	}

	function extractBalances(cell: any): Record<string, number> {
		const balances: Record<string, number> = {};
		if (!cell || typeof cell !== 'object') return balances;
		if (Array.isArray(cell.positions)) {
			for (const pos of cell.positions) {
				if (pos?.units?.currency && pos.units.number != null)
					balances[pos.units.currency] = parseFloat(pos.units.number);
			}
			return balances;
		}
		if (cell.units?.currency && cell.units.number != null) {
			balances[cell.units.currency] = parseFloat(cell.units.number);
			return balances;
		}
		if (cell.currency && cell.number != null) balances[cell.currency] = parseFloat(cell.number);
		return balances;
	}

	function onSettingsClick(e: Event) {
		e.stopPropagation();
		goto('/accounts/groups/' + index);
	}
</script>

<HomeCardTemplate headerStyle={group.color ? `background-color: ${group.color}` : undefined}>
	{#snippet title()}
		{group.title}
		{#if $isReloading}<span class="loading loading-spinner loading-xs ml-2 opacity-70"></span>{/if}
	{/snippet}
	{#snippet menu()}
		<button
			type="button"
			class="btn btn-ghost btn-circle btn-sm {group.color ? 'text-base-content/70' : 'text-primary-content'}"
			onclick={onSettingsClick}
			aria-label="Group settings"
		>
			<Settings2Icon size={16} />
		</button>
	{/snippet}
	{#snippet content()}
		{#if accounts.length === 0}
			<p class="px-2 py-1 text-sm opacity-60">No accounts added</p>
		{:else}
			{#each accounts as account (account.name)}
				<AccountRow {account} {balancesLoaded} {maxBalance} onclick={onAccountClick} />
			{/each}
		{/if}
	{/snippet}
	{#snippet footer()}
		{#if accounts.length > 0 && balancesLoaded}
			<div class="flex w-full flex-wrap justify-end gap-x-4 gap-y-0.5 border-t-4 border-double border-base-200 px-3 py-1 text-sm font-semibold">
				{#each Object.entries(currencyTotals) as [currency, total]}
					<span>{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</span>
				{/each}
			</div>
		{/if}
	{/snippet}
</HomeCardTemplate>
