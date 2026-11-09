<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import Fab from '#lib/components/FAB.svelte';
	import Notifier from '#lib/utils/notifier';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { saveBalanceAssertion } from '#lib/reconciliation/saveAssertion';
	import { selectionMetadata } from '#lib/data/mainStore';
	import { SelectionType } from '#lib/enums';
	import { SelectionModeMetadata } from '#lib/settings';
	import appService from '#lib/services/appService';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import {
		loadAccountPostings,
		loadBookBalance,
		loadLatestAssertion,
		type AccountPosting
	} from '#lib/reconciliation/bookBalance';
	import {
		assertionDateFor,
		reconciliationDifference,
		sumTicked,
		type BalanceAssertion
	} from '#lib/reconciliation/reconciliation';
	import * as Formatter from '#lib/utils/formatter';
	import { onMount } from 'svelte';

	const accountName = $derived(page.url.searchParams.get('account') ?? '');

	let statementDate = $state(new Date().toISOString().substring(0, 10));
	let statementBalance = $state('');
	let currency = $state('');
	let accountCurrencies: string[] = $state([]);

	let bookBalance: number | undefined = $state();
	/** The last assertion before the statement date: where reconciliation starts from. */
	let assertion: BalanceAssertion | undefined = $state();
	/** Postings since the starting point, up to the statement date. */
	let postings: AccountPosting[] = $state([]);
	let ticked: boolean[] = $state([]);
	let loading = $state(false);
	let error = $state('');

	const statementValue = $derived(parseFloat(statementBalance));
	const difference = $derived(
		bookBalance === undefined || isNaN(statementValue)
			? undefined
			: reconciliationDifference(bookBalance, statementValue)
	);

	/** Balance at the starting point: the assertion's amount, or zero when there is none. */
	const opening = $derived(assertion?.amount ?? 0);
	const clearedBalance = $derived(
		opening +
			sumTicked(
				postings.map((p) => p.amount),
				ticked
			)
	);
	const remaining = $derived(
		isNaN(statementValue) ? undefined : reconciliationDifference(clearedBalance, statementValue)
	);
	const tickedCount = $derived(ticked.filter(Boolean).length);

	/**
	 * Beancount checks an assertion against the whole account, so saving is only offered when
	 * the book itself matches the statement, whatever has been ticked.
	 */
	const canSave = $derived(difference === 0 && !loading);
	let saving = $state(false);

	async function onSave() {
		if (!canSave || saving) return;
		saving = true;
		try {
			await saveBalanceAssertion({
				account: accountName,
				date: assertionDateFor(statementDate),
				amount: statementValue,
				currency
			});
			Notifier.success('Balance assertion saved');
			await goto(`/accounts/account-xacts/${encodeURIComponent(accountName)}`);
		} catch (e) {
			Notifier.error(`Could not save: ${e instanceof Error ? e.message : e}`);
		} finally {
			saving = false;
		}
	}

	function setAllTicked(value: boolean) {
		ticked = postings.map(() => value);
	}

	onMount(async () => {
		if (await handleAccountSelection()) return;
		currency = await appService.getDefaultCurrency();
	});

	/** Picks up the account chosen on the /accounts page. Returns true if it navigated. */
	async function handleAccountSelection(): Promise<boolean> {
		const meta = $selectionMetadata;
		if (!meta || meta.selectionType !== SelectionType.ACCOUNT) return false;
		selectionMetadata.set(undefined);
		const name = meta.selectedId as string;
		if (!name) return false;
		await goto(`/accounts/reconcile?account=${encodeURIComponent(name)}`, { replaceState: true });
		return true;
	}

	async function onSelectAccount() {
		const meta = new SelectionModeMetadata();
		meta.selectionType = SelectionType.ACCOUNT;
		selectionMetadata.set(meta);
		await goto('/accounts');
	}

	// Load the account's currencies whenever the account changes.
	$effect(() => {
		const name = accountName;
		if (!name) return;
		(async () => {
			await fullLedgerService.ensureLoaded();
			const account = await fullLedgerService.getAccountWithBalances(name);
			if (name !== accountName) return;
			accountCurrencies = Object.keys(account?.balances ?? {});
			if (accountCurrencies.length && !accountCurrencies.includes(currency)) {
				currency = accountCurrencies[0];
			}
		})();
	});

	// Recompute the book balance when the account, currency or date changes.
	let request = 0;
	$effect(() => {
		const name = accountName;
		const cur = currency.trim().toUpperCase();
		const date = statementDate;
		if (!name || !cur || !date) {
			bookBalance = undefined;
			assertion = undefined;
			postings = [];
			ticked = [];
			return;
		}
		const id = ++request;
		loading = true;
		error = '';
		(async () => {
			const [balance, last] = await Promise.all([
				loadBookBalance(name, cur, date),
				loadLatestAssertion(name, cur, date)
			]);
			const list = await loadAccountPostings(name, cur, date, last?.date);
			if (id !== request) return;
			bookBalance = balance;
			assertion = last;
			postings = list;
			// A changed window invalidates earlier ticks.
			ticked = list.map(() => false);
		})()
			.catch((e) => {
				if (id !== request) return;
				bookBalance = undefined;
				assertion = undefined;
				postings = [];
				ticked = [];
				error = e instanceof Error ? e.message : String(e);
			})
			.finally(() => {
				if (id === request) loading = false;
			});
	});
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Reconcile Account" />

	{#if canSave}
		<Fab Icon={CheckIcon} onclick={onSave} />
	{/if}

	<section class="container mx-auto flex-1 space-y-4 overflow-y-auto p-4 lg:max-w-screen-sm">
		<div class="form-control">
			<label class="label" for="account"><span class="label-text">Account</span></label>
			<button
				id="account"
				type="button"
				class="input input-bordered w-full cursor-pointer text-left"
				onclick={onSelectAccount}
			>
				{#if accountName}
					{accountName}
				{:else}
					<span class="opacity-50">Select an account…</span>
				{/if}
			</button>
		</div>

		{#if accountName}
			<div class="form-control">
				<label class="label" for="statement-date">
					<span class="label-text">Statement closing date</span>
				</label>
				<input
					id="statement-date"
					type="date"
					class="input bg-primary/20 w-full"
					bind:value={statementDate}
				/>
			</div>

			<div class="form-control">
				<label class="label" for="statement-balance">
					<span class="label-text font-semibold">Statement closing balance</span>
				</label>
				<div class="flex items-center gap-1">
					<input
						id="statement-balance"
						type="number"
						step="0.01"
						class="input bg-primary/20 flex-1"
						bind:value={statementBalance}
						placeholder="0.00"
					/>
					<input
						type="text"
						class="input bg-primary/20 w-20 text-center uppercase"
						bind:value={currency}
						list="account-currencies"
						placeholder="EUR"
						aria-label="Currency"
					/>
					<datalist id="account-currencies">
						{#each accountCurrencies as c (c)}
							<option value={c}></option>
						{/each}
					</datalist>
				</div>
			</div>

			{#if error}
				<div class="alert alert-error alert-soft text-sm">{error}</div>
			{/if}

			<div class="card bg-base-200">
				<div class="card-body gap-2 p-4 tabular-nums">
					<div class="flex justify-between">
						<span>Book balance</span>
						<span>
							{#if loading}
								<span class="loading loading-spinner loading-xs"></span>
							{:else if bookBalance !== undefined}
								<data class={Formatter.getAmountColour(bookBalance)}>
									{Formatter.formatAmount(bookBalance)}
								</data>
								<span class="font-mono">{currency.toUpperCase()}</span>
							{:else}
								–
							{/if}
						</span>
					</div>
					<div class="flex justify-between">
						<span>Statement balance</span>
						<span>
							{#if !isNaN(statementValue)}
								<data class={Formatter.getAmountColour(statementValue)}>
									{Formatter.formatAmount(statementValue)}
								</data>
								<span class="font-mono">{currency.toUpperCase()}</span>
							{:else}
								–
							{/if}
						</span>
					</div>
					<div class="border-base-content/20 flex justify-between border-t pt-2 font-semibold">
						<span>Difference</span>
						<span>
							{#if difference !== undefined && !loading}
								<data class={difference === 0 ? 'text-success' : 'text-error'}>
									{Formatter.formatAmount(difference)}
								</data>
								<span class="font-mono">{currency.toUpperCase()}</span>
							{:else}
								–
							{/if}
						</span>
					</div>
				</div>
			</div>

			{#if difference === 0 && !loading}
				<div class="alert alert-success alert-soft text-sm">
					The book agrees with the statement. Tap the check button to save a balance assertion
					dated {assertionDateFor(statementDate)}.
				</div>
			{:else if difference !== undefined && !loading && remaining === 0 && tickedCount > 0}
				<div class="alert alert-warning alert-soft text-sm">
					The ticked transactions match the statement, but the book still differs. Unticked
					transactions are in the book and not on the statement; check them before saving an
					assertion.
				</div>
			{/if}

			<div class="alert alert-info alert-soft text-sm">
				<span>
					The book balance includes all transactions dated on or before the statement closing
					date, from your books and from this device.
				</span>
			</div>

			{#if !loading && bookBalance !== undefined}
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<h2 class="font-semibold">
							Transactions
							<span class="text-base-content/60 text-sm font-normal">
								({tickedCount}/{postings.length} ticked)
							</span>
						</h2>
						<div class="flex gap-1">
							<button class="btn btn-xs" onclick={() => setAllTicked(true)}>All</button>
							<button class="btn btn-xs" onclick={() => setAllTicked(false)}>None</button>
						</div>
					</div>

					<p class="text-base-content/60 text-sm">
						{#if assertion}
							Starting from the balance assertion on {assertion.date}:
							{Formatter.formatAmount(assertion.amount)}
							{assertion.currency}.
						{:else}
							No earlier balance assertion, so starting from zero at the first transaction.
						{/if}
					</p>

					{#if postings.length === 0}
						<p class="text-sm">No transactions in this period.</p>
					{:else}
						<ul class="divide-base-content/15 divide-y">
							{#each postings as p, i (i)}
								<li>
									<label
										class="flex cursor-pointer items-center gap-2 py-2 {p.flag === '!'
											? 'border-l-4 border-amber-400 pl-1'
											: ''}"
									>
										<input
											type="checkbox"
											class="checkbox checkbox-sm"
											bind:checked={ticked[i]}
										/>
										<span class="min-w-0 flex-1">
											<span class="text-base-content/60 block text-xs">{p.date}</span>
											<span class="block truncate">
												{p.payee || p.narration || '(no description)'}
											</span>
										</span>
										<data
											class="tabular-nums {Formatter.getAmountColour(p.amount)}"
											value={p.amount}
										>
											{Formatter.formatAmount(p.amount)}
										</data>
									</label>
								</li>
							{/each}
						</ul>
					{/if}

					<div class="card bg-base-200 sticky bottom-0">
						<div class="card-body gap-1 p-3 tabular-nums">
							<div class="flex justify-between text-sm">
								<span>Opening + ticked</span>
								<span>{Formatter.formatAmount(clearedBalance)} {currency.toUpperCase()}</span>
							</div>
							<div class="flex justify-between font-semibold">
								<span>Remaining difference</span>
								<span>
									{#if remaining !== undefined}
										<data class={remaining === 0 ? 'text-success' : 'text-error'}>
											{Formatter.formatAmount(remaining)}
										</data>
										{currency.toUpperCase()}
									{:else}
										–
									{/if}
								</span>
							</div>
						</div>
					</div>
				</div>
			{/if}
		{/if}
	</section>
</main>
