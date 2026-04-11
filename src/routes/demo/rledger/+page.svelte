<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from "$lib/components/Toolbar.svelte";
	import AccordionSection from '$lib/components/AccordionSection.svelte';
	import ledgerService from '$lib/services/ledgerService';
	import type { BeancountError, Directive, ParsedLedger } from '@rustledger/wasm';
	import { DirectiveFormatter } from '$lib/rledger/directiveFormatter';
	import { Account } from '$lib/data/model';
	import rustledger from '$lib/services/rustledger';
	import {
		findLastTransactionDirective,
		extractPayees,
		createDemoSource
	} from '$lib/rledger/rledgerPageService';
	import {
		mapDirectiveSpans,
		replaceDirectiveBySpan,
		findSpanForDirective,
		type DirectiveSpan
	} from '$lib/rledger/sourceEditor';

	import SourceViewer from './SourceViewer.svelte';
	import ValidationResults from './ValidationResults.svelte';
	import DirectivesTable from './DirectivesTable.svelte';
	import TransactionEditor from './TransactionEditor.svelte';
	import ErrorTable from './ErrorTable.svelte';

	// State
	let isLoading = $state(false);
	let error: string | null = $state(null);
	let initialized = $state(false);
	let wasmVersion = $state('');

	// Editable transaction source (only transactions, not infrastructure)
	let transactionSource = $state('');

	// UI state
	let sourceOnly = $state(false);

	// Accordion state
	let expandedSections: Record<string, boolean> = $state({});

	// Transaction editing state
	let editingDirectiveIndex = $state(-1);
	let isEditingTransaction = $state(false);
	let editedTransactionText = $state('');
	let editError: string | null = $state(null);
	let currentSpans: DirectiveSpan[] = $state([]);

	// Single ParsedLedger instance
	let parsedLedger: ParsedLedger | null = $state(null);

	// Parsed results
	let parsedAccounts: Account[] = $state([]);
	let parsedDirectives: Directive[] = $state([]);
	let parsedPayees: Array<{payee: string, descriptions: string[]}> = $state([]);

	// Validation state
	let validationErrors: BeancountError[] = $state([]);
	let validationWarnings: BeancountError[] = $state([]);
	let isValid = $state(false);
	let hasValidated = $state(false);

	// Format state
	let formattedSource = $state('');
	let formatErrors: BeancountError[] = $state([]);
	let hasFormatted = $state(false);

	// Derived state
	let fullBeancountSource = $derived(
		transactionSource
	);

	let lastTransactionDirective = $derived(findLastTransactionDirective(parsedDirectives));
	let transactionAnatomy = $derived(
		lastTransactionDirective ? DirectiveFormatter.toString(lastTransactionDirective) : ''
	);

	// Initialize
	onMount(async () => {
		try {
			isLoading = true;
			error = null;

			await ledgerService.ensureInitialized();
			wasmVersion = ledgerService.getWasmVersion();
			initialized = true;

			// await loadInfrastructure();

			// await importJournal();
			if (!transactionSource) {
				transactionSource = createDemoSource();
			}

			await handleParse();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to initialize RustLedger';
			console.error('RustLedger initialization error:', err);
		} finally {
			isLoading = false;
		}
	});

	async function handleParse() {
		try {
			isLoading = true;
			error = null;

			if (parsedLedger) {
				parsedLedger.free();
				parsedLedger = null;
			}

			parsedLedger = ledgerService.createParsedLedger(fullBeancountSource);
			if (!parsedLedger) {
				throw new Error('Failed to create ParsedLedger — WASM module not available');
			}

			parsedDirectives = parsedLedger.getDirectives();
			parsedAccounts = ledgerService.getAccountsFromTransactions(parsedLedger);
			parsedPayees = extractPayees(parsedDirectives);
		} catch (err) {
			if (parsedLedger) { parsedLedger.free(); parsedLedger = null; }
			parsedDirectives = [];
			parsedAccounts = [];
			parsedPayees = [];
			error = err instanceof Error ? err.message : 'Failed to parse Beancount source';
			console.error('Parse error:', err);
		} finally {
			isLoading = false;
		}
	}

	// async function importJournal() {
	// 	try {
	// 		isLoading = true;
	// 		error = null;
	// 		transactionSource = await appService.getExportTransactions();
	// 	} catch (err) {
	// 		error = err instanceof Error ? err.message : 'Failed to import journal';
	// 		console.error('Import error:', err);
	// 	} finally {
	// 		isLoading = false;
	// 	}
	// }

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
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to validate Beancount source';
			console.error('Validation error:', err);
		} finally {
			isLoading = false;
			hasValidated = true;
		}
	}

	async function handleFormat() {
		try {
			isLoading = true;
			error = null;
			formattedSource = '';
			formatErrors = [];

			const result = ledgerService.format(fullBeancountSource);
			formattedSource = result.formatted ?? '';
			formatErrors = result.errors ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to format Beancount source';
			console.error('Format error:', err);
		} finally {
			isLoading = false;
			hasFormatted = true;
		}
	}

	function toggleSection(sectionId: string) {
		expandedSections[sectionId] = !expandedSections[sectionId];
	}

	async function handleSourceOnlyToggle() {
		await handleParse();
	}

	function handleEditDirective(index: number) {
		const targetDirective = parsedDirectives[index];
		if (!targetDirective || targetDirective.type !== 'transaction') return;
		if (!parsedLedger) return;

		// Build source spans from document symbols
		const spans = mapDirectiveSpans(fullBeancountSource, parsedLedger);
		const spanIndex = findSpanForDirective(spans, index, fullBeancountSource, parsedDirectives);

		if (spanIndex === -1) {
			editError = 'Could not locate this directive in the source.';
			return;
		}

		isEditingTransaction = true;
		editingDirectiveIndex = spanIndex;
		currentSpans = spans;
		// Use the original source text, preserving formatting
		editedTransactionText = spans[spanIndex].sourceText;
		editError = null;
	}

	function handleSaveTransaction() {
		if (!isEditingTransaction || editingDirectiveIndex === -1) return;

		editError = null;

		// Validate the edited text parses as a valid directive
		const tempParseResult = rustledger.parseSource(editedTransactionText);
		const editedDirective = tempParseResult.ledger?.directives[0];

		if (!editedDirective) {
			editError = 'Failed to parse edited transaction. Check the syntax.';
			return;
		}

		if (editedDirective.type !== 'transaction') {
			editError = 'Edited directive is not a transaction.';
			return;
		}

		// Splice only the edited span into the full source
		const newFullSource = replaceDirectiveBySpan(
			fullBeancountSource,
			currentSpans,
			editingDirectiveIndex,
			editedTransactionText
		);

		// Derive the transaction source from the new full source
		if (sourceOnly) {
			transactionSource = newFullSource;
		} else {
			transactionSource = newFullSource;
		}

		isEditingTransaction = false;
		editingDirectiveIndex = -1;
		editedTransactionText = '';
		currentSpans = [];
		editError = null;

		handleParse();
	}

	function handleCancelEdit() {
		isEditingTransaction = false;
		editedTransactionText = '';
		currentSpans = [];
		editError = null;
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

			<div class="mt-4 flex flex-wrap gap-2">
				<button class="btn btn-accent" onclick={handleValidate} disabled={isLoading}>
					{#if isLoading}
						<span class="loading loading-spinner"></span> Validating...
					{:else}
						Validate
					{/if}
				</button>

				<button class="btn btn-primary" onclick={handleParse} disabled={isLoading}>
					{#if isLoading}
						<span class="loading loading-spinner"></span> Parsing...
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
						onchange={handleSourceOnlyToggle}
						disabled={isLoading}
					/>
				</label>

				<button
					class="btn btn-secondary ml-auto"
					onclick={() => { transactionSource = createDemoSource(); }}
					disabled={isLoading}
				>
					Create Demo Transactions
				</button>

				{#if sourceOnly && parsedDirectives.length >= 2}
					<button
						class="btn btn-info"
						onclick={() => handleEditDirective(1)}
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
	</section>

	<!-- Edit Transaction Section -->
	{#if isEditingTransaction}
		<TransactionEditor
			editedText={editedTransactionText}
			directiveIndex={editingDirectiveIndex}
			{isLoading}
			error={editError}
			onSave={handleSaveTransaction}
			onCancel={handleCancelEdit}
			onTextChange={(text) => { editedTransactionText = text; }}
		/>
	{/if}

	<!-- Full Beancount Source -->
	<AccordionSection
		title="Full Beancount Source"
		expanded={expandedSections['full-source'] ?? false}
		onToggle={() => toggleSection('full-source')}
	>
		<SourceViewer
			source={fullBeancountSource}
			infrastructureLength={0}
			transactionLength={transactionSource.length}
		/>
	</AccordionSection>

	<!-- Validation Results -->
	<AccordionSection
		title="Validation Results"
		expanded={expandedSections['validation'] ?? false}
		onToggle={() => toggleSection('validation')}
	>
		<ValidationResults {validationErrors} {validationWarnings} {isValid} {hasValidated} />
	</AccordionSection>

	<!-- Parsed Accounts -->
	<AccordionSection
		title="Parsed Accounts"
		badge={parsedAccounts.length}
		expanded={expandedSections['accounts'] ?? false}
		onToggle={() => toggleSection('accounts')}
	>
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
	</AccordionSection>

	<!-- Parsed Payees -->
	<AccordionSection
		title="Parsed Payees"
		badge={parsedPayees.length}
		expanded={expandedSections['payees'] ?? false}
		onToggle={() => toggleSection('payees')}
	>
		{#if parsedPayees.length === 0}
			<p class="text-base-content/50">No payees parsed yet.</p>
		{:else}
			<div class="overflow-x-auto overflow-y-auto max-h-[400px]">
				<table class="table table-zebra">
					<thead>
						<tr>
							<th>Payee</th>
							<th>Description (Note)</th>
						</tr>
					</thead>
					<tbody>
						{#each parsedPayees as {payee, descriptions}}
							<tr>
								<td>{payee}</td>
								<td>
									{#if descriptions.length > 0}
										<ul class="list-disc list-inside">
											{#each descriptions as desc}
												<li>{desc}</li>
											{/each}
										</ul>
									{:else}
										<span class="text-base-content/50">(no description)</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</AccordionSection>

	<!-- Parsed Directives -->
	<AccordionSection
		title="Parsed Directives"
		badge={parsedDirectives.length}
		expanded={expandedSections['directives'] ?? false}
		onToggle={() => toggleSection('directives')}
	>
		<DirectivesTable
			directives={parsedDirectives}
			{parsedLedger}
			onEdit={sourceOnly ? handleEditDirective : undefined}
		/>
	</AccordionSection>

	<!-- Transaction Anatomy -->
	<AccordionSection
		title="Transaction Anatomy"
		expanded={expandedSections['anatomy'] ?? false}
		onToggle={() => toggleSection('anatomy')}
	>
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
	</AccordionSection>

	<!-- Format Output -->
	<AccordionSection
		title="Format Output"
		expanded={expandedSections['format'] ?? false}
		onToggle={() => toggleSection('format')}
	>
		<p class="text-sm text-base-content/70">
			Reformats the full Beancount source using <span class="font-mono">format()</span> from WASM — consistent alignment and whitespace.
		</p>

		<div class="mt-4">
			<button class="btn btn-primary" onclick={handleFormat} disabled={isLoading}>
				{#if isLoading}
					<span class="loading loading-spinner"></span> Formatting...
				{:else}
					Format
				{/if}
			</button>
		</div>

		{#if hasFormatted}
			<ErrorTable errors={formatErrors} title="Format Errors" variant="error" />

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
	</AccordionSection>
</main>
