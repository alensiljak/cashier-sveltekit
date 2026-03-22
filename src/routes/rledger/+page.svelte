<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from "$lib/components/Toolbar.svelte";
	import rustledger, { createParsedLedger } from '$lib/services/rustledger';
	import type { BeancountError } from '@rustledger/wasm';
	import { Account, Money } from '$lib/data/model';
	import appService from '$lib/services/appService';

	// State
	let isLoading = false;
	let error: string | null = null;
	let initialized = false;

	// Editable Beancount source
	let beancountSource = `2024-01-01 * "Opening Balance" "Initial balances"
    Assets:Bank:Checking   1000.00 EUR
    Assets:Bank:Savings    500.00 EUR
    Liabilities:CreditCard -200.00 EUR

2024-01-02 * "Transfer" "Moving money"
    Assets:Bank:Checking   -100.00 EUR
    Assets:Bank:Savings     100.00 EUR`;

	// Parsed results
	let parsedAccounts: Account[] = [];
	let currentValues: Record<string, { quantity: number; currency: string }> = {};
	const tupleSamples = ['(100.00 EUR)', '(500.50 USD)', '(-25.75 GBP)'];
	let parsedMoneySamples: Array<{ tuple: string; money: Money }> = [];

	// Validation state
	let validationErrors: BeancountError[] = [];
	let validationWarnings: BeancountError[] = [];
	let isValid = false;

	// Initialize WASM
	onMount(async () => {
		try {
			isLoading = true;
			error = null;

			// Initialize the WASM module
			await rustledger.ensureInitialized();
			initialized = true;
			updateMoneySamples();

			// Parse the default Beancount source
			await handleParse();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to initialize RustLedger';
			console.error('RustLedger initialization error:', err);
		} finally {
			isLoading = false;
		}
	});

	function updateMoneySamples() {
		parsedMoneySamples = tupleSamples.map((tuple) => ({
			tuple,
			money: rustledger.getMoneyFromTupleString(tuple)
		}));
	}

	/**
	 * Handle parse button click
	 */
	async function handleParse() {
		try {
			isLoading = true;
			error = null;

			// Parse current values directly from Beancount source
			currentValues = rustledger.parseCurrentValues(
				beancountSource,
				'Assets'
			);

			// Extract accounts from current values for display
			parsedAccounts = Object.entries(currentValues).map(([name, data]) => {
				const account = new Account('');
				account.name = name;
				account.balances = { [data.currency]: data.quantity };
				return account;
			});

			console.log('Parsed accounts:', parsedAccounts);
			console.log('Current values:', currentValues);

		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to parse Beancount source';
			console.error('Parse error:', err);
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Import current journal from database into the text area
	 */
	async function handleImportJournal() {
		try {
			isLoading = true;
			error = null;

			// Get all transactions in Beancount format
			const journalSource = await appService.getExportTransactions();
			
			// Update the textarea
			beancountSource = journalSource;

			console.log('Journal imported successfully');

		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to import journal';
			console.error('Import error:', err);
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Validate the Beancount source using WASM only
	 */
	async function handleValidate() {
		try {
			isLoading = true;
			error = null;
			validationErrors = [];
			validationWarnings = [];

			// Use WASM for validation (validationSource is already set to 'wasm')
			const ledger = createParsedLedger(beancountSource);
			if (!ledger) {
				throw new Error('Failed to create ParsedLedger - WASM module not available');
			}
			const parseErrors = ledger.getParseErrors();
			const validationErrorsWasm = ledger.getValidationErrors();
			
			validationErrors = [...parseErrors, ...validationErrorsWasm].filter(err => err.severity === 'error');
			validationWarnings = [...parseErrors, ...validationErrorsWasm].filter(err => err.severity === 'warning');
			isValid = ledger.isValid();
			ledger.free();

			console.log('Validation complete:', { isValid, errors: validationErrors, warnings: validationWarnings });

		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to validate Beancount source';
			console.error('Validation error:', err);
		} finally {
			isLoading = false;
		}
	}
</script>

<Toolbar title="RustLedger Demo" />

<main class="mx-auto max-w-6xl space-y-4 p-4">
	<!-- Status Section -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body">
			<h2 class="card-title">Integration Status</h2>

			<div class="flex items-center gap-4">
				<div class="badge" class:badge-success={initialized} class:badge-error={!initialized && !isLoading}>
					{initialized ? 'WASM Loaded' : 'Not Loaded'}
				</div>

				{#if isLoading}
					<span class="loading loading-spinner"></span>
					<span>Processing...</span>
				{/if}
			</div>
		</div>
	</section>

	<!-- Beancount Source Section -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body">
			<h2 class="card-title">Beancount Source</h2>
			<p class="text-sm text-base-content/70">
				Edit the Beancount source below and click "Parse" to process it with RustLedger.
			</p>

			<div class="form-control">
				<textarea
					bind:value={beancountSource}
					class="textarea textarea-bordered h-64 font-mono text-sm w-full"
					placeholder="Enter Beancount source..."
				></textarea>
			</div>

			<div class="mt-4 flex gap-2">
				<button
					class="btn btn-secondary"
					on:click={handleImportJournal}
					disabled={isLoading}
				>
					Import Journal
				</button>

				<button
					class="btn btn-accent"
					on:click={handleValidate}
					disabled={isLoading}
				>
					{#if isLoading}
						<span class="loading loading-spinner"></span>
						Validating...
					{:else}
						Validate
					{/if}
				</button>

				<button
					class="btn btn-primary"
					on:click={handleParse}
					disabled={isLoading}
				>
					{#if isLoading}
						<span class="loading loading-spinner"></span>
						Parsing...
					{:else}
						Parse
					{/if}
				</button>
			</div>

			{#if error}
				<div class="alert alert-error mt-4">
					<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<span>{error}</span>
				</div>
			{/if}
		</div>
	</section>

	<!-- Validation Results Section -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body">
			<h2 class="card-title">
				Validation Results
			</h2>

			{#if validationErrors.length === 0 && validationWarnings.length === 0}
				<p class="text-base-content/50">No validation results yet. Click "Validate" to check the Beancount source.</p>
			{:else}
				<!-- Overall Status -->
				<div class="mb-4">
					<div class="alert {isValid ? 'alert-success' : 'alert-error'}">
						<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="{isValid ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' : 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z'}" />
						</svg>
						<span>
							<strong>{isValid ? 'Valid' : 'Invalid'}</strong>
							- {validationErrors.length} error(s), {validationWarnings.length} warning(s)
						</span>
					</div>
				</div>

				<!-- Errors Section -->
				{#if validationErrors.length > 0}
					<div class="mb-4">
						<h3 class="text-lg font-bold text-error">Errors ({validationErrors.length})</h3>
						<div class="overflow-x-auto">
							<table class="table table-zebra table-sm">
								<thead>
									<tr>
										<th>Line</th>
										<th>Column</th>
										<th>Message</th>
									</tr>
								</thead>
								<tbody>
									{#each validationErrors as err}
										<tr class="text-error">
											<td>{err.line}</td>
											<td>{err.column}</td>
											<td>{err.message}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}

				<!-- Warnings Section -->
				{#if validationWarnings.length > 0}
					<div>
						<h3 class="text-lg font-bold text-warning">Warnings ({validationWarnings.length})</h3>
						<div class="overflow-x-auto">
							<table class="table table-zebra table-sm">
								<thead>
									<tr>
										<th>Line</th>
										<th>Column</th>
										<th>Message</th>
									</tr>
								</thead>
								<tbody>
									{#each validationWarnings as warn}
										<tr class="text-warning">
											<td>{warn.line}</td>
											<td>{warn.column}</td>
											<td>{warn.message}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}
			{/if}
		</div>
	</section>

	<!-- Parsed Accounts Section -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body">
			<h2 class="card-title">
				Parsed Accounts ({parsedAccounts.length})
			</h2>

			{#if parsedAccounts.length === 0}
				<p class="text-base-content/50">No accounts parsed yet.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="table table-zebra">
						<thead>
							<tr>
								<th>Account Name</th>
								<th>Balances</th>
							</tr>
						</thead>
						<tbody>
							{#each parsedAccounts as account}
								<tr>
									<td>{account.name}</td>
									<td class="text-right">
										{#if account.balances}
											{Object.entries(account.balances).map(([currency, amount]) =>
												`${amount.toFixed(2)} ${currency}`
											).join(', ')}
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</section>

	<!-- Current Values Section -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body">
			<h2 class="card-title">
				Current Values (Root: Assets)
			</h2>
			<p class="text-sm text-base-content/70">
				Parsed using parseCurrentValues() with root account "Assets"
			</p>

			{#if Object.keys(currentValues).length === 0}
				<p class="text-base-content/50">No current values parsed yet.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="table table-zebra">
						<thead>
							<tr>
								<th>Account</th>
								<th>Quantity</th>
								<th>Currency</th>
							</tr>
						</thead>
						<tbody>
							{#each Object.entries(currentValues) as [account, data]}
								<tr>
									<td>{account}</td>
									<td class="text-right">{data.quantity.toFixed(2)}</td>
									<td>{data.currency}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</section>

	<!-- Money Tuple Parsing Test -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body">
			<h2 class="card-title">
				Money Tuple Parsing Test
			</h2>
			<p class="text-sm text-base-content/70">
				Testing getMoneyFromTupleString() with various formats
			</p>

			{#if !initialized}
				<p class="text-base-content/50">Money tuple samples will appear after the WASM module loads.</p>
			{:else}
				<div class="grid gap-2">
					{#each parsedMoneySamples as { tuple, money }}
					<div class="flex items-center gap-4 p-2 bg-base-200 rounded">
						<span class="font-mono">{tuple}</span>
						<span class="text-primary">→</span>
						<span>{money.quantity.toFixed(2)} {money.currency}</span>
					</div>
					{/each}
				</div>
			{/if}
		</div>
	</section>

</main>
