<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from "$lib/components/Toolbar.svelte";
	import rustledger, { createParsedLedger, parseAllAccounts, parseSource, version } from '$lib/services/rustledger';
	import type { BeancountError, Directive, ParseResult } from '@rustledger/wasm';
	import { Account, Money } from '$lib/data/model';
	import appService from '$lib/services/appService';
	import * as OpfsLib from '$lib/utils/opfslib.js';
	import { InfrastructureFiles } from '$lib/constants';

	// State
	let isLoading = false;
	let error: string | null = null;
	let initialized = false;
	let wasmVersion = '';

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
	let expandedSections = new Set<string>([
		'status',
		'transaction-source',
		'full-source',
		'validation',
		'accounts',
		'directives',
		'anatomy',
		'money-tuple'
	]);
	
	function toggleSection(sectionId: string) {
		if (expandedSections.has(sectionId)) {
			expandedSections.delete(sectionId);
		} else {
			expandedSections.add(sectionId);
		}
		// Trigger reactivity
		expandedSections = new Set(expandedSections);
	}
	
	// Source display
	let sourceContainer: HTMLDivElement;
	$: sourceLines = fullBeancountSource ? fullBeancountSource.split('\n') : [];

	// Parsed results
	let parsedAccounts: Account[] = [];
	let parseResult: ParseResult | null = null;
	let parsedDirectives: Directive[] = [];
	let lastTransactionDirective: Directive | null = null;
	let transactionAnatomy = '';
	const tupleSamples = ['(100.00 EUR)', '(500.50 USD)', '(-25.75 GBP)'];
	let parsedMoneySamples: Array<{ tuple: string; money: Money }> = [];

	// Validation state
	let validationErrors: BeancountError[] = [];
	let validationWarnings: BeancountError[] = [];
	let isValid = false;
	let hasValidated = false;

	// Reactive: update full source when components change
	$: fullBeancountSource = sourceOnly
		? transactionSource
		: infrastructureSource && transactionSource
			? `${infrastructureSource}\n\n${transactionSource}`
			: infrastructureSource || transactionSource || '';

	$: lastTransactionDirective = findLastTransactionDirective(parsedDirectives);
	$: transactionAnatomy = lastTransactionDirective ? formatTransactionAnatomy(lastTransactionDirective) : '';

	async function handleSourceOnlyToggle() {
		await handleParse();
	}

	// Initialize WASM
	onMount(async () => {
		try {
			isLoading = true;
			error = null;

			// Initialize the WASM module
			await rustledger.ensureInitialized();
			initialized = true;
			wasmVersion = version();
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

	function quoteString(value: unknown): string {
		const text = String(value ?? '');
		return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
	}

	function formatAmount(value: unknown): string {
		if (!value || typeof value !== 'object') {
			return String(value ?? '');
		}

		const record = value as Record<string, unknown>;
		if (typeof record.number === 'string' || typeof record.number === 'number') {
			const currency = typeof record.currency === 'string' ? ` ${record.currency}` : '';
			return `${record.number}${currency}`.trim();
		}

		return JSON.stringify(value);
	}

	function formatMetaValue(value: unknown): string {
		if (typeof value === 'string') {
			return quoteString(value);
		}
		if (typeof value === 'number' || typeof value === 'boolean') {
			return String(value);
		}
		if (value == null) {
			return 'null';
		}
		if (Array.isArray(value) || typeof value === 'object') {
			return quoteString(JSON.stringify(value));
		}
		return quoteString(String(value));
	}

	function formatCost(cost: unknown): string {
		if (!cost || typeof cost !== 'object') {
			return '';
		}

		const record = cost as Record<string, unknown>;
		if (record.number != null) {
			return ` {${formatAmount(cost)}}`;
		}

		return ` {${JSON.stringify(cost)}}`;
	}

	function formatPrice(price: unknown): string {
		if (!price) {
			return '';
		}
		return ` @ ${formatAmount(price)}`;
	}

	function formatExtraFields(record: Record<string, unknown>, knownKeys: Set<string>, indent: string): string[] {
		const lines: string[] = [];
		for (const [key, value] of Object.entries(record)) {
			if (knownKeys.has(key) || value == null) {
				continue;
			}
			lines.push(`${indent}; ${key}: ${JSON.stringify(value)}`);
		}
		return lines;
	}

	function findLastTransactionDirective(directives: Directive[]): Directive | null {
		for (let i = directives.length - 1; i >= 0; i -= 1) {
			if (directives[i].type === 'transaction') {
				return directives[i];
			}
		}
		return null;
	}

	function formatTransactionAnatomy(directive: Directive): string {
		if (directive.type !== 'transaction') {
			return '';
		}

		const tx = directive as unknown as Record<string, unknown>;
		const txMeta = (tx.meta ?? {}) as Record<string, unknown>;
		const tags = Array.isArray(tx.tags) ? tx.tags : [];
		const links = Array.isArray(tx.links) ? tx.links : [];
		const postings = Array.isArray(tx.postings) ? tx.postings : [];
		//const flag = typeof tx.flag === 'string' ? tx.flag : '*';
		const flag = tx.flag;
		const payee = tx.payee != null && tx.payee !== '' ? quoteString(tx.payee) : '';
		const narration = tx.narration != null && tx.narration !== '' ? quoteString(tx.narration) : '""';

		const tagTokens = tags
			.map((tag) => String(tag))
			.filter(Boolean)
			.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
		const linkTokens = links
			.map((link) => String(link))
			.filter(Boolean)
			.map((link) => (link.startsWith('^') ? link : `^${link}`));

		const headerParts = [String(tx.date ?? ''), flag, payee, narration, ...tagTokens, ...linkTokens].filter(Boolean);
		const lines = [headerParts.join(' ')];

		for (const [key, value] of Object.entries(txMeta)) {
			lines.push(`    ${key}: ${formatMetaValue(value)}`);
		}

		for (const postingValue of postings) {
			const posting = postingValue as Record<string, unknown>;
			const postingFlag = typeof posting.flag === 'string' ? `${posting.flag} ` : '';
			const account = String(posting.account ?? '');
			const units = posting.units ? `  ${formatAmount(posting.units)}` : '';
			const cost = formatCost(posting.cost);
			const price = formatPrice(posting.price);
			const comment = typeof posting.comment === 'string' ? `  ; ${posting.comment}` : '';

			lines.push(`    ${postingFlag}${account}${units}${cost}${price}${comment}`);

			if (posting.meta && typeof posting.meta === 'object') {
				for (const [key, value] of Object.entries(posting.meta as Record<string, unknown>)) {
					lines.push(`        ${key}: ${formatMetaValue(value)}`);
				}
			}

			lines.push(...formatExtraFields(posting, new Set(['account', 'flag', 'units', 'cost', 'price', 'comment', 'meta']), '        '));
		}

		lines.push(...formatExtraFields(tx, new Set(['type', 'date', 'flag', 'payee', 'narration', 'tags', 'links', 'meta', 'postings']), '    '));
		return lines.join('\n');
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
			parseResult = parseSource(fullBeancountSource);
			parsedDirectives = parseResult.ledger?.directives ?? [];

			// Parse all accounts from combined Beancount source (unfiltered)
			parsedAccounts = parseAllAccounts(fullBeancountSource);

			console.log('Parsed accounts:', parsedAccounts);

		} catch (err) {
			parseResult = null;
			parsedDirectives = [];
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
		<div class="card-body p-4" on:click={() => toggleSection('status')} class:cursor-pointer={true}>
			<div class="flex items-center justify-between">
				<h2 class="card-title m-0">Integration Status</h2>
				<svg class="w-6 h-6 transition-transform duration-200" class:rotate-90={expandedSections.has('status')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
			</div>
		</div>
		{#if expandedSections.has('status')}
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
		{/if}
	</section>

	<!-- Transaction Source Section -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body p-4" on:click={() => toggleSection('transaction-source')} class:cursor-pointer={true}>
			<div class="flex items-center justify-between">
				<h2 class="card-title m-0">Transaction Source</h2>
				<svg class="w-6 h-6 transition-transform duration-200" class:rotate-90={expandedSections.has('transaction-source')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
			</div>
		</div>
		{#if expandedSections.has('transaction-source')}
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
		{/if}
	</section>

	<!-- Full Beancount Source Section -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body p-4" on:click={() => toggleSection('full-source')} class:cursor-pointer={true}>
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
		<div class="card-body p-4" on:click={() => toggleSection('validation')} class:cursor-pointer={true}>
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
		<div class="card-body p-4" on:click={() => toggleSection('accounts')} class:cursor-pointer={true}>
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
		<div class="card-body p-4" on:click={() => toggleSection('directives')} class:cursor-pointer={true}>
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
				{#if !parseResult}
					<p class="text-base-content/50">No parse result yet. Click "Parse" to load directives from ParseResult.</p>
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
		<div class="card-body p-4" on:click={() => toggleSection('anatomy')} class:cursor-pointer={true}>
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

				{#if !parseResult}
					<p class="text-base-content/50">No parse result yet. Click "Parse" to inspect transaction anatomy.</p>
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

	<!-- Money Tuple Parsing Test -->
	<section class="card bg-base-100 shadow-xl">
		<div class="card-body p-4" on:click={() => toggleSection('money-tuple')} class:cursor-pointer={true}>
			<div class="flex items-center justify-between">
				<h2 class="card-title m-0">
					Money Tuple Parsing Test
				</h2>
				<svg class="w-6 h-6 transition-transform duration-200" class:rotate-90={expandedSections.has('money-tuple')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
			</div>
		</div>
		{#if expandedSections.has('money-tuple')}
			<div class="px-4 pb-4">
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
		{/if}
	</section>

</main>
