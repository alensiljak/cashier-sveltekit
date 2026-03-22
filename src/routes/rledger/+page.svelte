<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from "$lib/components/Toolbar.svelte";
	import rustledger, { createParsedLedger, parseAllAccounts } from '$lib/services/rustledger';
	import type { BeancountError } from '@rustledger/wasm';
	import { Account, Money } from '$lib/data/model';
	import appService from '$lib/services/appService';
	import * as OpfsLib from '$lib/utils/opfslib.js';
	import { InfrastructureFiles } from '$lib/constants';

	// State
	let isLoading = false;
	let error: string | null = null;
	let initialized = false;

	// Editable transaction source (only transactions, not infrastructure)
	let transactionSource = '';

	// Infrastructure source (book.bean from OPFS)
	let infrastructureSource = '';

	// Combined full Beancount source (infrastructure + transactions)
	let fullBeancountSource = '';

	// UI state
	let showFullSource = false;
	
	// Source display
	let sourceContainer: HTMLDivElement;
	$: sourceLines = fullBeancountSource ? fullBeancountSource.split('\n') : [];

	// Parsed results
	let parsedAccounts: Account[] = [];
	let currentValues: Record<string, { quantity: number; currency: string }> = {};
	const tupleSamples = ['(100.00 EUR)', '(500.50 USD)', '(-25.75 GBP)'];
	let parsedMoneySamples: Array<{ tuple: string; money: Money }> = [];

	// Validation state
	let validationErrors: BeancountError[] = [];
	let validationWarnings: BeancountError[] = [];
	let isValid = false;
	let hasValidated = false;

	// Reactive: update full source when components change
	$: fullBeancountSource = infrastructureSource && transactionSource
		? `${infrastructureSource}\n\n${transactionSource}`
		: infrastructureSource || transactionSource || '';

	// Initialize WASM
	onMount(async () => {
		try {
			isLoading = true;
			error = null;

			// Initialize the WASM module
			await rustledger.ensureInitialized();
			initialized = true;
			updateMoneySamples();

			// Load infrastructure file from OPFS
			await loadInfrastructure();
			
			await importJournal(); // Load current journal into textarea on startup
			if (!transactionSource) {
				createDemoEntries(); // If journal is empty, create demo entries
			}

			// Parse the combined Beancount source
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

	function createDemoEntries() {
			transactionSource = `2024-01-01 * "Opening Balance" "Initial balances"
    Assets:Bank:Checking   1000.00 EUR
    Assets:Bank:Savings    500.00 EUR
    Liabilities:CreditCard -200.00 EUR

2024-01-02 * "Transfer" "Moving money"
    Assets:Bank:Checking   -100.00 EUR
    Assets:Bank:Savings     100.00 EUR`;
	}

	/**
	 * Load all infrastructure files from OPFS and concatenate them
	 */
	async function loadInfrastructure() {
		try {
			const files = InfrastructureFiles; // ['book.bean', 'config.bean', 'commodities.bean', 'accounts.bean']
			const contents: string[] = [];
			
			for (const filename of files) {
				try {
					const content = await OpfsLib.readFile(filename);
					if (content) {
						contents.push(content);
						console.log(`Loaded ${filename} from OPFS`);
					} else {
						console.warn(`${filename} not found in OPFS`);
					}
				} catch (err) {
					console.warn(`Could not load ${filename}:`, err);
				}
			}
			
			// Concatenate all files with double newline separation
			infrastructureSource = contents.join('\n\n');
			console.log(`Infrastructure loaded: ${contents.length}/${files.length} files`);
		} catch (err) {
			console.warn('Could not load infrastructure files:', err);
			infrastructureSource = '';
		}
	}

	/**
	 * Handle parse button click
	 */
	async function handleParse() {
		try {
			isLoading = true;
			error = null;

			// Parse all accounts from combined Beancount source (unfiltered)
			parsedAccounts = parseAllAccounts(fullBeancountSource);

			// Parse current values filtered by root account "Assets"
			currentValues = rustledger.parseCurrentValues(
				fullBeancountSource,
				'Assets'
			);

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
	async function importJournal() {
		try {
			isLoading = true;
			error = null;

			// Get all transactions in Beancount format
			const journalSource = await appService.getExportTransactions();
			
			// Update the textarea
			transactionSource = journalSource;

			// fullBeancountSource updates reactively

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
			const ledger = createParsedLedger(fullBeancountSource);
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
			hasValidated = true;
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

	<!-- Transaction Source Section -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body">
			<h2 class="card-title">Transaction Source</h2>
			<p class="text-sm text-base-content/70">
				Edit the transactions below. The full Beancount source combines these transactions with the infrastructure file (book.bean) from OPFS.
			</p>

			<div class="form-control">
				<textarea
					bind:value={transactionSource}
					class="textarea textarea-bordered h-64 font-mono text-sm w-full"
					placeholder="Enter transactions..."
				></textarea>
			</div>

			<div class="mt-4 flex gap-2">
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

				<button
					class="btn btn-secondary"
					on:click={createDemoEntries}
					disabled={isLoading}
				>
					Create Demo Transactions
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

	<!-- Full Beancount Source Section (Expandable) -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body">
			<div class="flex items-center justify-between">
				<h2 class="card-title">Full Beancount Source</h2>
				<button
					class="btn btn-sm btn-outline"
					on:click={() => showFullSource = !showFullSource}
				>
					{showFullSource ? 'Hide' : 'Show'} Full Source
				</button>
			</div>
			<p class="text-sm text-base-content/70">
				Combined infrastructure (book.bean) and transactions. This is what gets validated and parsed.
			</p>

			{#if showFullSource}
				<div class="form-control mt-4">
					<div class="border border-base-300 rounded-lg overflow-hidden bg-base-200 font-mono text-sm">
						<div class="h-96 overflow-auto p-4" bind:this={sourceContainer}>
							{#each sourceLines as line, i}
								<div class="flex">
									<div class="flex-shrink-0 bg-base-300 text-base-content/50 text-right select-none px-3 py-1 border-r border-base-300 min-w-[3rem] leading-relaxed">
										{i + 1}
									</div>
									<div class="flex-1 px-4 py-1 whitespace-pre leading-relaxed">
										{line}
									</div>
								</div>
							{/each}
						</div>
					</div>
				</div>
				<div class="mt-2 text-sm text-base-content/50">
					Infrastructure: {infrastructureSource.length} chars | Transactions: {transactionSource.length} chars | Total: {fullBeancountSource.length} chars
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

			{#if hasValidated && validationErrors.length === 0 && validationWarnings.length === 0}
				<div class="alert alert-success">
					<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<span>
						<strong>Validation Successful!</strong> The Beancount source is valid with no errors or warnings.
					</span>
				</div>
			{:else if !hasValidated}
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
				<div class="overflow-x-auto overflow-y-auto max-h-[400px]">
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
