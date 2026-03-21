<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from "$lib/components/Toolbar.svelte";
	import rustledger, { lastParseBalanceSheetRowSource, lastParseCurrentValuesSource, lastGetMoneyFromTupleStringSource, isWasmAvailable, createParsedLedger } from '$lib/services/rustledger';
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

	// Track which implementation was used for each demo
	let parseBalanceSheetSource: 'wasm' | 'js' | null = null;
	let parseCurrentValuesSource: 'wasm' | 'js' | null = null;
	let getMoneyFromTupleStringSource: 'wasm' | 'js' | null = null;
	
	// Validation state
	let validationErrors: BeancountError[] = [];
	let validationWarnings: BeancountError[] = [];
	let isValid = false;
	let validationSource: 'wasm' | 'js' | null = null;

	// Initialize WASM
	onMount(async () => {
		try {
			isLoading = true;
			error = null;

			// Initialize the WASM module
			await rustledger.ensureInitialized();
			initialized = true;

			// Parse the default Beancount source
			handleParse();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to initialize RustLedger';
			console.error('RustLedger initialization error:', err);
		} finally {
			isLoading = false;
		}
	});

	/**
	 * Parse Beancount text and convert to array format expected by rustledger
	 * Extracts postings and converts to [amount, currency, account] format
	 */
	function parseBeancountToArray(source: string): Array<[string, string, string]> {
		const result: Array<[string, string, string]> = [];
		const lines = source.split('\n');

		for (const line of lines) {
			// Skip empty lines and non-posting lines (transactions start with date)
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('option ') || trimmed.startsWith('include ')) {
				continue;
			}

			// Check if this is a posting line (starts with whitespace or tab)
			// Beancount postings are indented with at least 2 spaces or a tab
			if (line.match(/^\s+\S/)) {
				// This is a posting line
				// Remove leading whitespace and split
				const posting = line.trim();

				// Split by whitespace, but account names can contain spaces
				// Format: <amount> <currency> <account>
				// Amount can be negative, positive, or in parentheses
				const parts = posting.split(/\s+/);

				if (parts.length >= 3) {
				// Beancount posting format: account amount currency
				const account = parts[0];
				const amount = parts[1];
				const currency = parts[2];

				// Only include if it looks like a valid posting
				if (/^[-()0-9.]+$/.test(amount) && /^[A-Z]{3}$/i.test(currency)) {
						result.push([amount, currency, account]);
					}
				}
			}
		}

		return result;
	}

	/**
	 * Handle parse button click
	 */
	async function handleParse() {
		try {
			isLoading = true;
			error = null;

			// Reset source tracking
			parseBalanceSheetSource = null;
			parseCurrentValuesSource = null;

			// Convert Beancount source to array format
			const parsedData = parseBeancountToArray(beancountSource);

			if (parsedData.length === 0) {
				error = 'No valid postings found in the Beancount source';
				return;
			}

			// Parse balance sheet rows
			parsedAccounts = parsedData
				.map(row => rustledger.parseBalanceSheetRow(row))
				.filter((account): account is Account => account !== null);
			// Capture the source used for the last call
			parseBalanceSheetSource = lastParseBalanceSheetRowSource;

			// Parse current values using beancount format directly
			currentValues = rustledger.parseCurrentValues(
				parsedData,
				'Assets'
			);
			// Capture the source used for the last call
			parseCurrentValuesSource = lastParseCurrentValuesSource;

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
	 * Validate the Beancount source using WASM or JS fallback
	 */
	async function handleValidate() {
		try {
			isLoading = true;
			error = null;
			validationErrors = [];
			validationWarnings = [];

			if (!isWasmAvailable()) {
				// Use JS fallback for validation
				validationSource = 'js';
				const ledger = createLedgerJS(beancountSource);
				const parseErrors = ledger.getParseErrors();
				const validationErrorsJS = ledger.getValidationErrors();
				
				validationErrors = [...parseErrors, ...validationErrorsJS].filter(err => err.severity === 'error');
				validationWarnings = [...parseErrors, ...validationErrorsJS].filter(err => err.severity === 'warning');
				isValid = validationErrors.length === 0;
			} else {
				// Use WASM for validation
				validationSource = 'wasm';
				const ledger = createParsedLedger(beancountSource);
				if (!ledger) {
					throw new Error('Failed to create ParsedLedger');
				}
				const parseErrors = ledger.getParseErrors();
				const validationErrorsWasm = ledger.getValidationErrors();
				
				validationErrors = [...parseErrors, ...validationErrorsWasm].filter(err => err.severity === 'error');
				validationWarnings = [...parseErrors, ...validationErrorsWasm].filter(err => err.severity === 'warning');
				isValid = ledger.isValid();
				ledger.free();
			}

			console.log('Validation complete:', { isValid, errors: validationErrors, warnings: validationWarnings });

		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to validate Beancount source';
			console.error('Validation error:', err);
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Create a ledger instance using JavaScript implementation
	 */
	function createLedgerJS(source: string): any {
		// Simple JS validation: check for basic syntax errors
		const errors: BeancountError[] = [];
		const lines = source.split('\n');
		
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			
			// Skip empty lines and comments
			if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('option ') || trimmed.startsWith('include ')) {
				continue;
			}
			
			// Check for transaction lines (should start with a date)
			if (trimmed.match(/^\d{4}-\d{2}-\d{2}/)) {
				// Transaction header - should have flag and description
				const parts = trimmed.split(/\s+/);
				if (parts.length < 3) {
					errors.push({
						message: 'Invalid transaction format: expected date, flag, and description',
						line: i + 1,
						column: 0,
						severity: 'error'
					});
				}
			}
			// Check for balance assertions
			else if (trimmed.startsWith('balance ')) {
				// Balance line should have account and amount
				const parts = trimmed.split(/\s+/);
				if (parts.length < 3) {
					errors.push({
						message: 'Invalid balance assertion: expected account and amount',
						line: i + 1,
						column: 0,
						severity: 'error'
					});
				}
			}
		}
		
		// Return a simple object with methods compatible with the interface
		return {
			getParseErrors: () => errors.filter(e => e.severity === 'error'),
			getValidationErrors: () => [],
			isValid: () => errors.length === 0
		};
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

	<!-- Parsed Accounts Section -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body">
			<h2 class="card-title">
				Parsed Accounts ({parsedAccounts.length})
				{#if parseBalanceSheetSource}
					<span class="badge {parseBalanceSheetSource === 'wasm' ? 'badge-success' : 'badge-neutral'} ml-2">
						{parseBalanceSheetSource === 'wasm' ? 'WASM' : 'JS Fallback'}
					</span>
				{/if}
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
				{#if parseCurrentValuesSource}
					<span class="badge {parseCurrentValuesSource === 'wasm' ? 'badge-success' : 'badge-neutral'} ml-2">
						{parseCurrentValuesSource === 'wasm' ? 'WASM' : 'JS Fallback'}
					</span>
				{/if}
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
				{#if getMoneyFromTupleStringSource}
					<span class="badge {getMoneyFromTupleStringSource === 'wasm' ? 'badge-success' : 'badge-neutral'} ml-2">
						{getMoneyFromTupleStringSource === 'wasm' ? 'WASM' : 'JS Fallback'}
					</span>
				{/if}
			</h2>
			<p class="text-sm text-base-content/70">
				Testing getMoneyFromTupleString() with various formats
			</p>

			<div class="grid gap-2">
				{#each ['(100.00 EUR)', '(500.50 USD)', '(-25.75 GBP)'] as tuple}
					{@const money = rustledger.getMoneyFromTupleString(tuple)}
					{@const source = getMoneyFromTupleStringSource || (lastGetMoneyFromTupleStringSource ? (lastGetMoneyFromTupleStringSource === 'wasm' ? 'wasm' : 'js') : null)}
					<div class="flex items-center gap-4 p-2 bg-base-200 rounded">
						<span class="font-mono">{tuple}</span>
						<span class="text-primary">→</span>
						<span>{money.quantity.toFixed(2)} {money.currency}</span>
						{#if source}
							<span class="badge {source === 'wasm' ? 'badge-success' : 'badge-neutral'} ml-auto text-xs">
								{source === 'wasm' ? 'WASM' : 'JS'}
							</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- Info Section -->
	<section class="alert alert-info">
		<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
		</svg>
		<div>
			<h3 class="font-bold">Integration Test</h3>
			<div class="text-xs">
				This page demonstrates the integration of @rustledger/wasm for Beancount parsing.
				The service automatically falls back to JavaScript implementations if WASM functions are unavailable.
			</div>
		</div>
	</section>
</main>
