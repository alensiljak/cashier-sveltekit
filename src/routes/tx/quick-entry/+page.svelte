<script lang="ts">
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import AccordionSection from '$lib/components/AccordionSection.svelte';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import Fab from '$lib/components/FAB.svelte';
	import { Xact, Posting } from '$lib/data/model';
	import { xact as xactStore, xactSpan } from '$lib/data/mainStore';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { parseEntitySearchTerms } from '$lib/utils/entitySearch';
	import { buildLooseTransactionConditions } from '$lib/services/entitySearchService';
	import { type ParseResult, parseTranscript, buildTransaction, refineFromMatches } from '$lib/utils/nlpEntry';
	import { CodeIcon, FilePlusIcon, TriangleAlertIcon } from '@lucide/svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';

	function focusOnMount(el: HTMLElement) {
		el.focus();
	}

	const NLP_EXAMPLES = [
		'10 euros for Decathlon, t-shirt',
		'Paid 25 euros at Starbucks',
		'Received 500 euros salary',
		'Transferred 100 euros from checking to savings'
	];

	const ACCOUNT_TYPES = ['Assets', 'Liabilities', 'Income', 'Expenses', 'Equity'] as const;
	const MAX_RESULTS = 10;
	const ID_FETCH_CAP = 150;
	const MIN_QUERY_LENGTH = 2;

	let searchText = $state('');
	let isLoading = $state(false);
	let isSelecting = $state(false);
	let filtersExpanded = $state(false);
	let templates = $state<Xact[]>([]);
	let visibleResultsCount = $state(MAX_RESULTS);
	let hasSearched = $state(false);
	let error = $state<string | null>(null);
	const visibleTemplates = $derived(templates.slice(0, visibleResultsCount));

	function showMoreResults() {
		visibleResultsCount += MAX_RESULTS;
	}

	let parseResult = $state<ParseResult | null>(null);
	let nlpXact = $state<Xact | null>(null);

	// Filters (all off by default)
	let filterDateFrom = $state('');
	let filterDateTo = $state('');
	let filterAccountType = $state('');

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let lastQuery = $state('');
	let queryDialog: HTMLDialogElement | undefined;
	let copySuccess = $state(false);

	let searchRequestId = 0;

	function runParse() {
		const text = searchText.trim();
		if (text.length < MIN_QUERY_LENGTH) {
			parseResult = null;
			nlpXact = null;
			return;
		}
		const result = parseTranscript(text);
		refineFromMatches(result, templates);
		parseResult = result;
		nlpXact = buildTransaction(result);
	}

	// Runs the loose multi-term search, then refines the NLP suggestion from its results
	// (frequency-ranked best match) — sequenced so refinement always sees the current results.
	async function runSearchAndParse() {
		const requestId = ++searchRequestId;
		await runSearch();
		if (requestId !== searchRequestId) return;
		runParse();
	}

	function useExample(phrase: string) {
		searchText = phrase;
		void runSearchAndParse();
	}

	function selectNlpXact(template: Xact) {
		isSelecting = true;
		try {
			const clone = new Xact();
			clone.date = template.date ?? new Date().toISOString().substring(0, 10);
			clone.payee = template.payee ?? '';
			clone.note = template.note ?? '';
			clone.flag = template.flag ?? '*';
			clone.postings = template.postings.map((p) => {
				const posting = new Posting();
				posting.account = p.account;
				posting.currency = p.currency;
				posting.amount = p.amount;
				return posting;
			});

			xactStore.set(clone);
			xactSpan.set(undefined);
			goto('/tx');
		} finally {
			isSelecting = false;
		}
	}

	function onInput() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			void runSearchAndParse();
		}, 400);
	}

	// Re-run search (and re-refine the suggestion) when filters change while there is active search text
	$effect(() => {
		// touch reactive filter values so the effect re-runs when they change
		void filterDateFrom;
		void filterDateTo;
		void filterAccountType;
		if (searchText.trim().length >= MIN_QUERY_LENGTH) {
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => void runSearchAndParse(), 400);
		}
	});


	/** Runs a single "any posting/payee/narration in this transaction satisfies `clause`" query,
	 *  returning its matching transaction ids in date-descending row order (deduped). */
	async function idsMatchingClause(clause: string): Promise<number[]> {
		const whereParts = [clause];
		if (filterDateFrom) whereParts.push(`date >= ${filterDateFrom}`);
		if (filterDateTo) whereParts.push(`date <= ${filterDateTo}`);

		const query = `SELECT id WHERE ${whereParts.join(' AND ')} ORDER BY date DESC`;
		const result = await fullLedgerService.query(query);
		if (result.errors?.length) {
			throw new Error((result.errors[0] as { message: string }).message);
		}
		const idIdx = (result.columns ?? []).indexOf('id');
		if (idIdx === -1) return [];

		const seen = new Set<number>();
		const ids: number[] = [];
		for (const row of (result.rows ?? []) as unknown[][]) {
			const id = Number(row[idIdx]);
			if (Number.isNaN(id) || seen.has(id)) continue;
			seen.add(id);
			ids.push(id);
		}
		return ids;
	}

	/**
	 * Finds transactions matching every term/filter clause. Each clause is queried
	 * independently and the id sets are intersected in JS, rather than ANDing every clause
	 * into one flattened WHERE — a single posting row only carries one `account` value, so a
	 * flattened AND can never match a transaction where different terms hit different postings
	 * (e.g. "n26 hiking" naming the asset account in one posting and the expense account in
	 * another). Capped at ID_FETCH_CAP, taking the first clause's date-descending order as the
	 * base ordering since intersection doesn't otherwise preserve one.
	 */
	async function findMatchingIds(text: string): Promise<number[]> {
		const terms = parseEntitySearchTerms(text);
		const categories = terms.map((t) => t.category);
		const clauses = buildLooseTransactionConditions(terms, categories);
		if (filterAccountType) clauses.push(`account ~ "^${filterAccountType}:"`);
		if (clauses.length === 0) return [];

		const idSets = await Promise.all(clauses.map((clause) => idsMatchingClause(clause)));
		const [base, ...rest] = idSets;
		const restSets = rest.map((ids) => new Set(ids));

		const result: number[] = [];
		for (const id of base) {
			if (restSets.every((set) => set.has(id))) {
				result.push(id);
				if (result.length >= ID_FETCH_CAP) break;
			}
		}
		return result;
	}

	async function runSearch() {
		const text = searchText.trim();
		if (text.length < 2) {
			templates = [];
			hasSearched = false;
			return;
		}

		isLoading = true;
		error = null;
		visibleResultsCount = MAX_RESULTS;
		await tick();

		try {
			const ids = await findMatchingIds(text);
			lastQuery = `(one SELECT id query per term, intersected — see findMatchingIds)`;
			if (ids.length === 0) {
				templates = [];
			} else {
				// Fetch every posting for those exact transactions, unfiltered by the original
				// clauses, so siblings that didn't themselves match a term still show up.
				const detailQuery =
					`SELECT id, date, payee, narration, account, number, currency` +
					` WHERE id IN (${ids.join(', ')})` +
					` ORDER BY date DESC`;
				lastQuery = detailQuery;
				const detailResult = await fullLedgerService.query(detailQuery);
				if (detailResult.errors?.length > 0) {
					error = (detailResult.errors[0] as { message: string }).message;
					templates = [];
				} else {
					templates = buildTemplates(detailResult.columns ?? [], (detailResult.rows ?? []) as unknown[][]);
				}
			}
			hasSearched = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			templates = [];
		} finally {
			isLoading = false;
		}
	}

	function buildTemplates(columns: string[], rows: unknown[][]): Xact[] {
		if (!rows.length || !columns.length) return [];

		const idIdx = columns.indexOf('id');
		const dateIdx = columns.indexOf('date');
		const payeeIdx = columns.indexOf('payee');
		const narrationIdx = columns.indexOf('narration');
		const accountIdx = columns.indexOf('account');
		const numberIdx = columns.indexOf('number');
		const currencyIdx = columns.indexOf('currency');

		// Group raw rows into full transactions by id (every posting, not just matching ones)
		const txKeyOrder: string[] = [];
		const txMap = new Map<
			string,
			{ date: string; payee: string; narration: string; accounts: string[]; postings: Posting[] }
		>();

		for (const row of rows) {
			const id = String(row[idIdx] ?? '');
			const date = String(row[dateIdx] ?? '');
			const payee = String(row[payeeIdx] ?? '');
			const narration = String(row[narrationIdx] ?? '');
			const account = String(row[accountIdx] ?? '');
			const numVal = row[numberIdx];
			const currency = String(row[currencyIdx] ?? '');

			if (!txMap.has(id)) {
				txMap.set(id, { date, payee, narration, accounts: [], postings: [] });
				txKeyOrder.push(id);
			}

			const tx = txMap.get(id)!;
			const posting = new Posting();
			posting.account = account;
			posting.amount = typeof numVal === 'number' ? numVal : parseFloat(String(numVal));
			posting.currency = currency;
			tx.postings.push(posting);
			tx.accounts.push(account);
		}

		// Deduplicate recurring transactions (same payee/narration/account-shape) down to
		// their most-recent occurrence.
		const seen = new Set<string>();
		const result: Xact[] = [];

		for (const id of txKeyOrder) {
			const tx = txMap.get(id)!;
			const fingerprint = `${tx.payee}\0${tx.narration}\0${[...tx.accounts].sort().join('\0')}`;
			if (seen.has(fingerprint)) continue;
			seen.add(fingerprint);

			const xact = new Xact();
			xact.date = tx.date;
			xact.payee = tx.payee;
			xact.note = tx.narration;
			xact.postings = tx.postings;
			result.push(xact);
		}

		return result;
	}

	async function copyQuery() {
		await navigator.clipboard.writeText(lastQuery);
		copySuccess = true;
		setTimeout(() => (copySuccess = false), 2000);
	}

	async function selectTemplate(template: Xact) {
		isSelecting = true;
		try {
			const origPayee = template.payee ?? '';
			const origNarration = template.note ?? '';

			// Fetch ALL postings for this transaction. Use = for exact string equality.
			// Skip payee condition when empty to avoid `payee = ""` edge cases.
			const conditions = [`date = ${template.date}`, `narration = "${origNarration}"`];
			if (origPayee) conditions.push(`payee = "${origPayee}"`);

			const fetchQuery =
				`SELECT account, number, currency WHERE ${conditions.join(' AND ')}`;
			const result = await fullLedgerService.query(fetchQuery);

			let postings: Posting[];
			if (!result.errors?.length && (result.rows as unknown[][])?.length) {
				const cols = result.columns ?? [];
				const accountIdx = cols.indexOf('account');
				const numberIdx = cols.indexOf('number');
				const currencyIdx = cols.indexOf('currency');
				postings = (result.rows as unknown[][]).map((row) => {
					const p = new Posting();
					p.account = String(row[accountIdx] ?? '');
					const numVal = row[numberIdx];
					p.amount = typeof numVal === 'number' ? numVal : parseFloat(String(numVal));
					p.currency = String(row[currencyIdx] ?? '');
					return p;
				});
			} else {
				postings = template.postings;
			}

			const clone = new Xact();
			clone.date = new Date().toISOString().substring(0, 10);
			clone.payee = origPayee;
			clone.note = origNarration;
			clone.flag = template.flag ?? '*';
			// Leave the last posting's amount elided (auto-balance) instead of
			// carrying over its historical number. Otherwise, changing the amount
			// on any other posting leaves this one stale and unbalanced, forcing
			// the user to also clear it manually.
			clone.postings = postings.map((p, idx) => {
				const posting = new Posting();
				posting.account = p.account;
				posting.currency = p.currency;
				if (idx < postings.length - 1) {
					posting.amount = p.amount;
				}
				return posting;
			});

			xactStore.set(clone);
			xactSpan.set(undefined);
			goto('/tx');
		} finally {
			isSelecting = false;
		}
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Quick Entry">
		{#snippet actions()}
			<HelpButton topic="quick-entry" />
		{/snippet}
		{#snippet menuItems()}
			<ToolbarMenuItem text="Show Query" Icon={CodeIcon} onclick={() => queryDialog?.showModal()} />
		{/snippet}
	</Toolbar>

	<section class="flex flex-1 flex-col gap-3 overflow-y-auto touch-pan-y p-3">
		<!-- Entry input -->
		<input
			class="input mx-auto w-11/12 max-w-2xl rounded-full border-2 border-primary bg-primary/5 shadow-none focus:outline-none"
			type="search"
			placeholder="e.g. 10 euros for Decathlon, t-shirt"
			use:focusOnMount
			bind:value={searchText}
			oninput={onInput}
		/>

		<!-- Optional filters -->
		<AccordionSection
			title="Filters"
			expanded={filtersExpanded}
			onToggle={() => (filtersExpanded = !filtersExpanded)}
		>
			<div class="flex flex-col gap-3">
				<!-- Date range -->
				<div class="flex gap-2">
					<div class="flex flex-1 flex-col gap-1">
						<label class="label py-0 text-xs font-semibold text-base-content/60" for="date-from">
							From
						</label>
						<input
							id="date-from"
							type="date"
							class="input input-bordered input-sm w-full"
							bind:value={filterDateFrom}
						/>
					</div>
					<div class="flex flex-1 flex-col gap-1">
						<label class="label py-0 text-xs font-semibold text-base-content/60" for="date-to">
							To
						</label>
						<input
							id="date-to"
							type="date"
							class="input input-bordered input-sm w-full"
							bind:value={filterDateTo}
						/>
					</div>
				</div>

				<!-- Account type -->
				<div class="flex flex-col gap-1">
					<span class="label py-0 text-xs font-semibold text-base-content/60">Account type</span>
					<div class="flex flex-wrap gap-2">
						<label class="flex items-center gap-1 cursor-pointer">
							<input
								type="radio"
								class="radio radio-sm"
								name="acct-type"
								value=""
								bind:group={filterAccountType}
							/>
							<span class="text-sm">All</span>
						</label>
						{#each ACCOUNT_TYPES as type}
							<label class="flex items-center gap-1 cursor-pointer">
								<input
									type="radio"
									class="radio radio-sm"
									name="acct-type"
									value={type}
									bind:group={filterAccountType}
								/>
								<span class="text-sm">{type}</span>
							</label>
						{/each}
					</div>
				</div>
			</div>
		</AccordionSection>

		{#if searchText.trim().length < MIN_QUERY_LENGTH}
			<!-- Instructions -->
			<div class="card bg-base-200 shadow">
				<div class="card-body gap-2 p-4">
					<p class="text-sm">
						Describe a transaction, or type payee/account text to search past ones.
					</p>
					<h3 class="card-title text-sm">Try saying…</h3>
					<ul class="text-sm space-y-1">
						{#each NLP_EXAMPLES as phrase}
							<li>
								<button
									type="button"
									class="text-left opacity-70 hover:opacity-100 hover:underline"
									onclick={() => useExample(phrase)}
								>"{phrase}"</button>
							</li>
						{/each}
					</ul>
				</div>
			</div>
		{:else}
			<!-- Suggested new transaction -->
			{#if parseResult && nlpXact}
				<div class="flex flex-col gap-1">
					<div class="flex items-center justify-between">
						<span class="text-xs font-semibold uppercase tracking-wide text-base-content/60">
							Suggested new transaction
						</span>
						{#if parseResult.needsReview}
							<div class="badge badge-warning badge-sm gap-1 border-transparent text-neutral">
								<TriangleAlertIcon class="size-3" /> needs review
							</div>
						{:else}
							<div class="badge badge-success badge-sm">looks good</div>
						{/if}
					</div>
					<div class:pointer-events-none={isSelecting} class:opacity-50={isSelecting}>
						<JournalXactRow xact={nlpXact} onclick={selectNlpXact} />
					</div>
				</div>

				<div class="divider my-0 text-xs text-base-content/50">existing transactions</div>
			{/if}

			<!-- Search results -->
			{#if isLoading}
				<div class="flex justify-center py-8">
					<span class="loading loading-spinner loading-md"></span>
				</div>
			{:else if error}
				<div class="alert alert-error text-sm">{error}</div>
			{:else if hasSearched && templates.length === 0}
				<p class="py-8 text-center text-sm text-base-content/50">No matching transactions found.</p>
			{:else if templates.length > 0}
				{#if isSelecting}
					<div class="flex justify-center py-4">
						<span class="loading loading-spinner loading-md"></span>
					</div>
				{/if}
				<div
					class="flex flex-col divide-y divide-base-200"
					class:pointer-events-none={isSelecting}
					class:opacity-50={isSelecting}
				>
					{#each visibleTemplates as template (template)}
						<div class="py-2">
							<JournalXactRow xact={template} onclick={selectTemplate} />
						</div>
					{/each}
				</div>
				{#if visibleTemplates.length < templates.length}
					<div class="flex justify-center py-3">
						<button type="button" class="btn btn-outline btn-sm" onclick={showMoreResults}>
							Show More
						</button>
					</div>
				{/if}
			{/if}
		{/if}
	</section>

	<Fab Icon={FilePlusIcon} onclick={() => goto('/tx')} />

	<!-- BQL query debug dialog -->
	<dialog bind:this={queryDialog} class="modal">
		<div class="modal-box flex flex-col gap-3">
			<h3 class="font-bold text-lg">Last BQL Query</h3>
			{#if lastQuery}
				<pre class="bg-base-200 rounded p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all">{lastQuery}</pre>
				<button
					type="button"
					class="btn btn-sm {copySuccess ? 'btn-success' : 'btn-outline'} self-start"
					onclick={copyQuery}
				>
					{copySuccess ? 'Copied!' : 'Copy'}
				</button>
			{:else}
				<p class="text-sm text-base-content/60">No query run yet — type something to search first.</p>
			{/if}
			<div class="modal-action mt-0">
				<button type="button" class="btn" onclick={() => queryDialog?.close()}>Close</button>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop">
			<button>close</button>
		</form>
	</dialog>
</main>
