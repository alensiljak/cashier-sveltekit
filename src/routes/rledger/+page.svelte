<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from "$lib/components/Toolbar.svelte";
	import ledgerService from '$lib/services/ledgerService';
	import type { BeancountError, Directive, ParsedLedger } from '@rustledger/wasm';
	import { DirectiveFormatter } from '$lib/rledger/directiveFormatter';
	import { Account } from '$lib/data/model';
	import appService from '$lib/services/appService';
	import * as OpfsLib from '$lib/utils/opfslib.js';
	import { InfrastructureFiles } from '$lib/constants';
	import rustledger from '$lib/services/rustledger';

	// State
	let isLoading = false;
	let error: string | null = null;
	let initialized = false;
	let wasmVersion = '';
	let isLedgerServiceReady = false;
	
	// Editable transaction source (only transactions, not infrastructure)
	let transactionSource = '';
	
	// Infrastructure source (book.bean from OPFS)
	let infrastructureSource = '';
	
	// Combined full Beancount source (infrastructure + transactions)
	let fullBeancountSource = '';
	
	// UI state
	let showFullSource = false;
	let sourceOnly = false;
	
	// Accordion state - track which sections are expanded
	let expandedSections = new Set<string>();
	
	// Transaction editing POC state
	let editingDirectiveIndex = -1; // Index in parsedDirectives array, -1 = not editing
	let isEditingTransaction = false;
	let editedTransactionText = '';
	// We maintain an editable copy of directives separate from the parsedLedger
	let editableDirectives: Directive[] = [];
	
	// Source display
	let sourceContainer: HTMLDivElement;
	$: sourceLines = fullBeancountSource ? fullBeancountSource.split('\n') : [];
	
	// Single ParsedLedger instance — created on mount and on Parse button click
	let parsedLedger: ParsedLedger | null = null;
	
	// Parsed results
	let parsedAccounts: Account[] = [];
	let parsedDirectives: Directive[] = [];
	let lastTransactionDirective: Directive | null = null;
	let transactionAnatomy = '';
	
	// Validation state
	let validationErrors: BeancountError[] = [];
	let validationWarnings: BeancountError[] = [];
	let isValid = false;
	let hasValidated = false;
	
	// Format state
	let formattedSource = '';
	let formatErrors: BeancountError[] = [];
	let hasFormatted = false;
	
	// Reactive: update full source when components change
	$: fullBeancountSource = sourceOnly
		? transactionSource
		: infrastructureSource && transactionSource
			? `${infrastructureSource}\n\n${transactionSource}`
			: infrastructureSource || transactionSource || '';
	
	$: lastTransactionDirective = findLastTransactionDirective(parsedDirectives);
	$: transactionAnatomy = lastTransactionDirective ? DirectiveFormatter.toString(lastTransactionDirective) : '';

	// Initialize
	onMount(async () => {
		try {
			isLoading = true;
			error = null;

			// Wait for ledgerService to be ready (WASM initialized)
			await ledgerService.ensureInitialized();
			wasmVersion = ledgerService.getWasmVersion();
			initialized = true;
			isLedgerServiceReady = true;

			// Load infrastructure file from OPFS
			await loadInfrastructure();

			await importJournal(); // Load current journal into textarea on startup
			if (!transactionSource) {
				createDemoEntries(); // If journal is empty, create demo entries
			}

			// Parse the combined Beancount source
			await handleParse();

			console.log(parsedLedger);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to initialize RustLedger';
			console.error('RustLedger initialization error:', err);
		} finally {
			isLoading = false;
		}
	});

	function createDemoEntries() {
			transactionSource = `2024-01-01 * "Opening Balance" "Initial balances"
    Assets:Bank:Checking   1000.00 EUR
    Assets:Bank:Savings    500.00 EUR
    Liabilities:CreditCard -200.00 EUR

2024-01-02 * "Transfer" "Moving money"
    Assets:Bank:Checking   -100.00 EUR
    Assets:Bank:Savings     100.00 EUR`;
	}

	function formatDirectiveSummary(directive: Directive): string {
		switch (directive.type) {
			case 'transaction':
				return `${directive.narration || '(no narration)'} | ${directive.postings.length} posting(s)`;
			case 'balance':
				return `${directive.account} = ${directive.amount.number} ${directive.amount.currency}`;
			case 'open':
				return `${directive.account}${directive.currencies.length ? ` | ${directive.currencies.join(', ')}` : ''}`;
			case 'close':
				return directive.account;
			case 'commodity':
				return directive.currency;
			case 'pad':
				return `${directive.account} <= ${directive.source_account}`;
			case 'event':
				return `${directive.event_type}: ${directive.value}`;
			case 'note':
				return `${directive.account}: ${directive.comment}`;
			case 'document':
				return `${directive.account}: ${directive.path}`;
			case 'price':
				return `${directive.currency} ${directive.amount.number} ${directive.amount.currency}`;
			case 'query':
				return `${directive.name}: ${directive.query_string}`;
			case 'custom':
				return directive.custom_type;
			default:
				return '';
		}
	}

	function findLastTransactionDirective(directives: Directive[]): Directive | null {
		for (let i = directives.length - 1; i >= 0; i -= 1) {
			if (directives[i].type === 'transaction') {
				return directives[i];
			}
		}
		return null;
	}

	/**
	 * Split transaction source into individual transactions by double newlines
	 * Returns array of transaction strings
	 */
	function splitTransactions(source: string): string[] {
		// Split by double newlines (or more) to separate transactions
		const blocks = source.split(/\n{2,}/).filter(block => block.trim());
		// Further split blocks that contain multiple transactions (separated by single newlines with dates)
		const transactions: string[] = [];
		
		for (const block of blocks) {
			const lines = block.split('\n');
			let currentTx: string[] = [];
			
			for (const line of lines) {
				// Check if line starts a new transaction (date at beginning)
				if (/^\d{4}-\d{2}-\d{2}/.test(line.trim()) && currentTx.length > 0) {
					// Save current transaction and start new one
					transactions.push(currentTx.join('\n'));
					currentTx = [line];
				} else {
					currentTx.push(line);
				}
			}
			
			// Don't forget the last transaction in the block
			if (currentTx.length > 0) {
				transactions.push(currentTx.join('\n'));
			}
		}
		
		return transactions;
	}

	/**
	 * Format the Beancount source using WASM format()
	 */
	async function handleFormat() {
		try {
			isLoading = true;
			error = null;
			formattedSource = '';
			formatErrors = [];

			const result = ledgerService.format(fullBeancountSource);
			formattedSource = result.formatted ?? '';
			formatErrors = result.errors ?? [];

			console.log('Format complete:', { formattedSource, formatErrors });
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to format Beancount source';
			console.error('Format error:', err);
		} finally {
			isLoading = false;
			hasFormatted = true;
		}
	}

	/**
		* Format all directives (infrastructure + transactions) by:
		* 1. Getting all directives from parsedLedger
		* 2. Converting each to string using DirectiveFormatter
		* 3. Joining with double newlines
		* This demonstrates the "dump all Directives into string with format()" concept.
		*/
	async function handleFormatAll() {
		try {
			isLoading = true;
			error = null;
			formatErrors = [];
			formattedSource = '';

			if (!parsedLedger) {
				throw new Error('No parsed ledger available — click Parse first.');
			}

			// Get all directives from the parsed ledger (includes infrastructure)
			const allDirectives = parsedLedger.getDirectives();
			
			// Convert each directive to its string representation
			const formattedDirectives = allDirectives.map(directive =>
				DirectiveFormatter.toString(directive)
			);
			
			// Join with double newlines to create the formatted source
			formattedSource = formattedDirectives.join('\n\n');
			
			console.log('Format complete:', {
				directiveCount: allDirectives.length,
				formattedSourceLength: formattedSource.length
			});
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to format Beancount source';
			console.error('Format error:', err);
		} finally {
			isLoading = false;
			hasFormatted = true;
		}
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
	 * Handle parse button click — creates (or recreates) the single ParsedLedger
	 * instance used by all subsequent queries on this page.
	 */
	async function handleParse() {
		try {
			isLoading = true;
			error = null;

			// Free previous instance before creating a new one
			if (parsedLedger) {
				parsedLedger.free();
				parsedLedger = null;
			}

			parsedLedger = ledgerService.createParsedLedger(fullBeancountSource);
			if (!parsedLedger) {
				throw new Error('Failed to create ParsedLedger — WASM module not available');
			}

			parsedDirectives = parsedLedger.getDirectives();
			parsedAccounts = ledgerService.getAccountsFromLedger(parsedLedger);

			console.log('Parsed accounts:', parsedAccounts);
		} catch (err) {
			if (parsedLedger) { parsedLedger.free(); parsedLedger = null; }
			parsedDirectives = [];
			parsedAccounts = [];
			error = err instanceof Error ? err.message : 'Failed to parse Beancount source';
			console.error('Parse error:', err);
		} finally {
			isLoading = false;
		}

		// console.log('references:', parsedLedger?.getReferences());
		// console.log('properties', Object.getOwnPropertyNames(parsedLedger));
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
	 * Validate using the existing ParsedLedger — no new instance created.
	 * Call Parse first if the source has changed.
	 */
	async function handleValidate() {
		try {
			isLoading = true;
			error = null;
			validationErrors = [];
			validationWarnings = [];

			if (!parsedLedger) {
				throw new Error('No parsed ledger available — click Parse first.');
			}

			const parseErrors = parsedLedger.getParseErrors();
			const validationErrorsWasm = parsedLedger.getValidationErrors();

			validationErrors = [...parseErrors, ...validationErrorsWasm].filter(err => err.severity === 'error');
			validationWarnings = [...parseErrors, ...validationErrorsWasm].filter(err => err.severity === 'warning');
			isValid = parsedLedger.isValid();

			console.log('Validation complete:', { isValid, errors: validationErrors, warnings: validationWarnings });
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to validate Beancount source';
			console.error('Validation error:', err);
		} finally {
			isLoading = false;
			hasValidated = true;
		}
	}

	function toggleSection(sectionId: string) {
		if (expandedSections.has(sectionId)) {
			expandedSections.delete(sectionId);
		} else {
			expandedSections.add(sectionId);
		}
		// Trigger reactivity
		expandedSections = new Set(expandedSections);
	}

	async function handleSourceOnlyToggle() {
		await handleParse();
	}

	/**
	 * POC: Edit the second transaction directive in the source.
	 * This demonstrates how to take a Directive from the ParsedLedger,
	 * format it, and allow the user to edit it in the UI.
	 * Now uses directive index tracking instead of fragile string replacement.
	 */
	function handleEditSecondTransaction() {
		isEditingTransaction = true;
		// Use the second transaction (index 1) as the editing target
		const targetIndex = 1;
		const targetDirective = parsedDirectives[targetIndex];
		
		if (targetDirective && targetDirective.type === 'transaction') {
			// Store the index of the directive we're editing
			editingDirectiveIndex = targetIndex;
			
			// Initialize editableDirectives as a copy of parsedDirectives
			editableDirectives = [...parsedDirectives];
			
			// Format the directive for editing
			editedTransactionText = DirectiveFormatter.toString(targetDirective);
		} else {
			// No second transaction
			editingDirectiveIndex = -1;
			editableDirectives = [];
			editedTransactionText = '';
		}
	}
	
	/**
	 * Rebuild the transaction source from editableDirectives array.
	 * Only includes transaction directives (non-infrastructure).
	 */
	function rebuildTransactionSource(): string {
		if (editableDirectives.length === 0) {
			return transactionSource;
		}
		
		// Convert all directives back to source strings
		const directiveStrings = editableDirectives.map(directive =>
			DirectiveFormatter.toString(directive)
		);
		
		// Join with double newlines (standard Beancount separation)
		return directiveStrings.join('\n\n');
	}

	/**
	 * Save edited transaction back to the source.
	 * Uses directive index tracking to replace the directive in editableDirectives,
	 * then rebuilds the transaction source from all directives.
	 */
	function handleSaveTransaction() {
		if (!isEditingTransaction || editingDirectiveIndex === -1) {
			console.error('No transaction is being edited');
			return;
		}
		
		// Parse the edited transaction text to get a Directive object
		const tempParseResult = rustledger.parseSource(editedTransactionText);
		const editedDirective = tempParseResult.ledger?.directives[0];
		
		if (!editedDirective) {
			console.error('Failed to parse edited transaction');
			return;
		}
		
		// Validate that it's still a transaction
		if (editedDirective.type !== 'transaction') {
			console.error('Edited directive is not a transaction');
			return;
		}
		
		console.log('Replacing directive at index', editingDirectiveIndex, 'with', editedDirective);
		
		// Replace the directive in editableDirectives array
		editableDirectives[editingDirectiveIndex] = editedDirective;
		
		// Rebuild the transaction source from all editable directives
		transactionSource = rebuildTransactionSource();
		
		// Reset editing state
		isEditingTransaction = false;
		editingDirectiveIndex = -1;
		editedTransactionText = '';
		
		// Re-parse to update parsedDirectives and the UI
		handleParse();
	}

	function handleCancelEdit() {
		isEditingTransaction = false;
		editedTransactionText = '';
	}

</script>

<Toolbar title="RustLedger Demo" />

<main class="mx-auto max-w-6xl space-y-4 p-4">
	<!-- Status Section -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body p-4">
			<h2 class="card-title m-0">Integration Status</h2>
		</div>
		<div class="px-4 pb-4">
			<div class="flex items-center gap-4">
				<div class="badge" class:badge-success={initialized} class:badge-error={!initialized && !isLoading}>
					{initialized ? 'WASM Loaded' : 'Not Loaded'}
				</div>

				{#if initialized && wasmVersion}
					<span class="text-sm text-base-content/70">
						Version: {wasmVersion}
					</span>
				{/if}

				{#if isLoading}
					<span class="loading loading-spinner"></span>
					<span>Processing...</span>
				{/if}
			</div>
		</div>
	</section>

	<!-- Transaction Source Section -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body p-4">
			<h2 class="card-title m-0">Transaction Source</h2>
		</div>
		<div class="px-4 pb-4">
			<div class="px-4 pb-4">
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

					<label class="label cursor-pointer gap-2">
						<span class="label-text">Source only</span>
						<input
							type="checkbox"
							class="checkbox checkbox-sm"
							bind:checked={sourceOnly}
							on:change={handleSourceOnlyToggle}
							disabled={isLoading}
						/>
					</label>

					<button
						class="btn btn-secondary ml-auto"
						on:click={createDemoEntries}
						disabled={isLoading}
					>
						Create Demo Transactions
					</button>

					<button
						class="btn btn-accent ml-2"
						on:click={handleFormatAll}
						disabled={isLoading || !parsedLedger}
					>
						Format All (Directive-based)
					</button>

					{#if sourceOnly && parsedDirectives.length >= 2}
					<button
						class="btn btn-info ml-2"
						on:click={handleEditSecondTransaction}
						disabled={isLoading || !parsedLedger}
					>
						Edit Second Transaction
					</button>
					{/if}
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
		</div>
	</section>

	<!-- Edit Transaction Section -->
	{#if isEditingTransaction}
	<section class="card bg-base-100 shadow-xl border-2 border-info">
		<div class="card-body p-4">
			<div class="flex items-center justify-between mb-4">
				<h2 class="card-title m-0">Edit Transaction</h2>
				<button
					class="btn btn-sm btn-circle btn-ghost"
					on:click={handleCancelEdit}
					disabled={isLoading}
					aria-label="Cancel editing"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			
			<p class="text-sm text-base-content/70 mb-4">
				Editing transaction at index {editingDirectiveIndex}.
				Make your changes below and click Save to update.
			</p>
			
			<div class="form-control">
				<textarea
					bind:value={editedTransactionText}
					class="textarea textarea-bordered h-64 font-mono text-sm w-full"
					placeholder="Edit transaction..."
				></textarea>
			</div>
			
			<div class="mt-4 flex gap-2">
				<button
					class="btn btn-primary"
					on:click={handleSaveTransaction}
					disabled={isLoading}
				>
					{#if isLoading}
						<span class="loading loading-spinner"></span>
						Saving...
					{:else}
						Save
					{/if}
				</button>
				
				<button
					class="btn btn-ghost"
					on:click={handleCancelEdit}
					disabled={isLoading}
				>
					Cancel
				</button>
			</div>
		</div>
	</section>
	{/if}

	<!-- Full Beancount Source Section -->
	<section class="card bg-base-100 shadow-xl">
		<div role="button" tabindex="0" aria-pressed={expandedSections.has('full-source')} class="card-body p-4" on:click={() => toggleSection('full-source')} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { toggleSection('full-source'); } }} class:cursor-pointer={true}>
			<div class="flex items-center justify-between">
				<h2 class="card-title m-0">Full Beancount Source</h2>
				<svg class="w-6 h-6 transition-transform duration-200" class:rotate-90={expandedSections.has('full-source')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
			</div>
		</div>
		{#if expandedSections.has('full-source')}
			<div class="px-4 pb-4">
				<p class="text-sm text-base-content/70">
					Combined infrastructure (book.bean) and transactions. This is what gets validated and parsed.
				</p>

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
			</div>
		{/if}
	</section>

	<!-- Validation Results Section -->
	<section class="card bg-base-100 shadow-xl">
		<div role="button" tabindex="0" aria-pressed={expandedSections.has('validation')} class="card-body p-4" on:click={() => toggleSection('validation')} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { toggleSection('validation'); } }} class:cursor-pointer={true}>
			<div class="flex items-center justify-between">
				<h2 class="card-title m-0">Validation Results</h2>
				<svg class="w-6 h-6 transition-transform duration-200" class:rotate-90={expandedSections.has('validation')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
			</div>
		</div>
		{#if expandedSections.has('validation')}
			<div class="px-4 pb-4">
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
		{/if}
	</section>

	<!-- Parsed Accounts Section -->
	<section class="card bg-base-100 shadow-xl">
		<div role="button" tabindex="0" aria-pressed={expandedSections.has('accounts')} class="card-body p-4" on:click={() => toggleSection('accounts')} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { toggleSection('accounts'); } }} class:cursor-pointer={true}>
			<div class="flex items-center justify-between">
				<h2 class="card-title m-0">
					Parsed Accounts ({parsedAccounts.length})
				</h2>
				<svg class="w-6 h-6 transition-transform duration-200" class:rotate-90={expandedSections.has('accounts')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
			</div>
		</div>
		{#if expandedSections.has('accounts')}
			<div class="px-4 pb-4">
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
		{/if}
	</section>

	<!-- Parsed Directives Section -->
	<section class="card bg-base-100 shadow-xl">
		<div role="button" tabindex="0" aria-pressed={expandedSections.has('directives')} class="card-body p-4" on:click={() => toggleSection('directives')} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { toggleSection('directives'); } }} class:cursor-pointer={true}>
			<div class="flex items-center justify-between">
				<h2 class="card-title m-0">
					Parsed Directives ({parsedDirectives.length})
				</h2>
				<svg class="w-6 h-6 transition-transform duration-200" class:rotate-90={expandedSections.has('directives')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
			</div>
		</div>
		{#if expandedSections.has('directives')}
			<div class="px-4 pb-4">
			{#if !parsedLedger}
				<p class="text-base-content/50">No parsed ledger yet. Click "Parse" to load directives.</p>
				{:else if parsedDirectives.length === 0}
					<p class="text-base-content/50">No directives found in the parse result.</p>
				{:else}
					<div class="overflow-x-auto overflow-y-auto max-h-[400px]">
						<table class="table table-zebra table-sm">
							<thead>
								<tr>
									<th>#</th>
									<th>Date</th>
									<th>Type</th>
									<th>Summary</th>
								</tr>
							</thead>
							<tbody>
								{#each parsedDirectives as directive, idx}
									<tr>
										<td>{idx + 1}</td>
										<td>{(directive as Directive).date}</td>
										<td><span class="badge badge-outline">{(directive as Directive).type}</span></td>
										<td class="font-mono text-xs">{formatDirectiveSummary(directive as Directive)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		{/if}
	</section>

	<!-- Transaction Anatomy Section -->
	<section class="card bg-base-100 shadow-xl">
		<div role="button" tabindex="0" aria-pressed={expandedSections.has('anatomy')} class="card-body p-4" on:click={() => toggleSection('anatomy')} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { toggleSection('anatomy'); } }} class:cursor-pointer={true}>
			<div class="flex items-center justify-between">
				<h2 class="card-title m-0">Transaction Anatomy</h2>
				<svg class="w-6 h-6 transition-transform duration-200" class:rotate-90={expandedSections.has('anatomy')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
			</div>
		</div>
		{#if expandedSections.has('anatomy')}
			<div class="px-4 pb-4">
				<p class="text-sm text-base-content/70">
					Formatted Beancount view of the last parsed <span class="font-mono">transaction</span> directive for comparison with the source string.
				</p>

			{#if !parsedLedger}
				<p class="text-base-content/50">No parsed ledger yet. Click "Parse" to inspect transaction anatomy.</p>
				{:else if !lastTransactionDirective}
					<p class="text-base-content/50">No transaction directive found in parsed directives.</p>
				{:else}
					<div class="mt-3 rounded-lg border border-base-300 bg-base-200 p-4">
						<pre class="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">{transactionAnatomy}</pre>
					</div>
				{/if}
			</div>
		{/if}
	</section>
	<!-- Format Output Section -->
	<section class="card bg-base-100 shadow-xl">
		<div role="button" tabindex="0" aria-pressed={expandedSections.has('format')} class="card-body p-4" on:click={() => toggleSection('format')} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { toggleSection('format'); } }} class:cursor-pointer={true}>
			<div class="flex items-center justify-between">
				<h2 class="card-title m-0">Format Output</h2>
				<svg class="w-6 h-6 transition-transform duration-200" class:rotate-90={expandedSections.has('format')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
			</div>
		</div>
		{#if expandedSections.has('format')}
			<div class="px-4 pb-4">
				<p class="text-sm text-base-content/70">
					Reformats the full Beancount source using <span class="font-mono">format()</span> from WASM — consistent alignment and whitespace.
				</p>

				<div class="mt-4">
					<button
						class="btn btn-primary"
						on:click={handleFormat}
						disabled={isLoading}
					>
						{#if isLoading}
							<span class="loading loading-spinner"></span>
							Formatting...
						{:else}
							Format
						{/if}
					</button>
				</div>

				{#if hasFormatted}
					{#if formatErrors.length > 0}
						<div class="mt-4">
							<h3 class="text-lg font-bold text-error">Format Errors ({formatErrors.length})</h3>
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
										{#each formatErrors as err}
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

					{#if formattedSource}
						<div class="mt-4 rounded-lg border border-base-300 bg-base-200 p-4">
							<pre class="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">{formattedSource}</pre>
						</div>
					{:else if formatErrors.length === 0}
						<p class="mt-4 text-base-content/50">No formatted output returned.</p>
					{/if}
				{:else}
					<p class="mt-4 text-base-content/50">Click "Format" to reformat the Beancount source.</p>
				{/if}
			</div>
		{/if}
	</section>
</main>
