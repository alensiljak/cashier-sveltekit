<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import Fab from '$lib/components/FAB.svelte';
	import { xact, selectionMetadata } from '$lib/data/mainStore';
	import { Posting, Xact } from '$lib/data/model';
	import { SelectionModeMetadata } from '$lib/settings';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import appService from '$lib/services/appService';
	import { CheckIcon, CalculatorIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	const accountName = $derived(page.url.searchParams.get('account') ?? '');

	let ledgerBalance = $state(0);
	let enteredBalance = $state('');

	onMount(async () => {
		if ($selectionMetadata?.origin === 'bal-adj') {
			// Returning from account or calculator selection — restore saved state
			const meta = $selectionMetadata;
			selectionMetadata.set(undefined);

			if ($xact?.note) {
				const [savedBalance, savedLedger] = $xact.note.split('|');
				enteredBalance = savedBalance ?? '';
				ledgerBalance = parseFloat(savedLedger ?? '0') || 0;
				$xact.note = '';
			}

			if (meta.selectionType === 'account' && meta.selectedId) {
				$xact.postings[0].account = meta.selectedId as string;
			} else if (meta.selectionType === 'amount' && meta.selectedId !== undefined) {
				enteredBalance = String(meta.selectedId);
			}
			return;
		}

		// Normal initialisation: build the xact and load the ledger balance
		const tx = new Xact();
		tx.date = new Date().toISOString().substring(0, 10);
		tx.payee = 'Balance Adjustment';
		tx.flag = '*';
		tx.postings = [new Posting(), new Posting()];
		tx.postings[1].account = accountName;

		const defaultCurrency = await appService.getDefaultCurrency();
		tx.postings[0].currency = defaultCurrency;

		if (accountName) {
			await fullLedgerService.ensureLoaded();
			const account = await fullLedgerService.getAccountWithBalances(accountName);
			if (account?.balances) {
				const keys = Object.keys(account.balances);
				if (keys.length) {
					ledgerBalance = account.balances[keys[0]];
					tx.postings[0].currency = keys[0];
				}
			}
			enteredBalance = String(ledgerBalance);
		}

		xact.set(tx);
	});

	/** Persist current form values into xact.note before leaving this page. */
	function saveState() {
		if ($xact) $xact.note = `${enteredBalance}|${ledgerBalance}`;
	}

	async function selectExpenseAccount() {
		saveState();
		const meta = new SelectionModeMetadata();
		meta.origin = 'bal-adj';
		meta.selectionType = 'account';
		selectionMetadata.set(meta);
		await goto('/accounts');
	}

	async function openCalculator() {
		saveState();
		const meta = new SelectionModeMetadata();
		meta.origin = 'bal-adj';
		meta.selectionType = 'amount';
		meta.initialValue = parseFloat(enteredBalance) || 0;
		selectionMetadata.set(meta);
		await goto('/calculator');
	}

	async function onFab() {
		if (!$xact) return;
		const entered = parseFloat(enteredBalance);
		if (isNaN(entered)) return;

		$xact.note = '';
		$xact.postings[0].amount = -(entered - ledgerBalance);
		$xact.postings[1].account = accountName;

		await goto('/tx');
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Balance Adjustment" />

	<section class="container mx-auto flex-1 overflow-y-auto p-4 space-y-4 lg:max-w-screen-sm">
		<Fab Icon={CheckIcon} onclick={onFab} />

		{#if $xact}
			<!-- Account being balanced (informational) -->
			<div class="form-control">
				<label class="label" for="account">
					<span class="label-text">Account</span>
				</label>
				<input
					id="account"
					type="text"
					class="input input-bordered w-full"
					value={accountName}
					readonly
				/>
			</div>

			<!-- Ledger balance (informational) -->
			<div class="form-control">
				<div class="label">
					<span class="label-text">Ledger Balance</span>
				</div>
				<div class="input input-bordered flex items-center opacity-60">
					{ledgerBalance}
					<span class="ml-2 text-sm">{$xact.postings[0].currency}</span>
				</div>
			</div>

			<!-- Current (actual) balance — primary action field -->
			<div class="form-control">
				<label class="label" for="entered-balance">
					<span class="label-text font-semibold">Current Balance</span>
				</label>
				<div class="flex gap-1 items-center">
					<input
						id="entered-balance"
						type="number"
						step="0.01"
						class="input bg-primary/20 flex-1"
						bind:value={enteredBalance}
						placeholder="0.00"
					/>
					<button
						type="button"
						class="btn btn-outline w-12 shrink-0 rounded px-1"
						onclick={openCalculator}
						title="Open calculator"
					>
						<CalculatorIcon />
					</button>
					<input
						type="text"
						class="input bg-primary/20 w-20 text-center uppercase"
						bind:value={$xact.postings[0].currency}
						placeholder="EUR"
					/>
				</div>
			</div>

			<!-- Difference (calculated) -->
			{#if enteredBalance !== ''}
				{@const diff = parseFloat(enteredBalance) - ledgerBalance}
				{#if !isNaN(diff) && diff !== 0}
					<div class="form-control">
						<div class="label">
							<span class="label-text">Difference</span>
						</div>
						<div
							class="input input-bordered flex items-center {diff < 0
								? 'text-error'
								: 'text-success'}"
						>
							{diff > 0 ? '+' : ''}{diff.toFixed(2)}
							<span class="ml-2 text-sm">{$xact.postings[0].currency}</span>
						</div>
					</div>
				{/if}
			{/if}

			<!-- Expense account — tap to select from account list -->
			<div class="form-control">
				<label class="label" for="expense-account">
					<span class="label-text font-semibold">Expense Account</span>
				</label>
				<input
					id="expense-account"
					type="text"
					class="input bg-primary/20 w-full"
					bind:value={$xact.postings[0].account}
					placeholder="Expenses:Adjustment"
					readonly
					onclick={selectExpenseAccount}
				/>
			</div>
		{:else}
			<div class="flex h-full items-center justify-center">
				<span class="loading loading-spinner loading-lg"></span>
			</div>
		{/if}
	</section>
</main>
