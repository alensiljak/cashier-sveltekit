<script lang="ts">
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import AccordionSection from '$lib/components/AccordionSection.svelte';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import { Xact, Posting } from '$lib/data/model';
	import { xact as xactStore, xactSpan } from '$lib/data/mainStore';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { CodeIcon } from '@lucide/svelte';

	function focusOnMount(el: HTMLElement) {
		el.focus();
	}

	const ACCOUNT_TYPES = ['Assets', 'Liabilities', 'Income', 'Expenses', 'Equity'] as const;
	const MAX_RESULTS = 15;

	let searchText = $state('');
	let isLoading = $state(false);
	let isSelecting = $state(false);
	let filtersExpanded = $state(false);
	let templates = $state<Xact[]>([]);
	let hasSearched = $state(false);
	let error = $state<string | null>(null);

	// Filters (all off by default)
	let filterDateFrom = $state('');
	let filterDateTo = $state('');
	let filterAccountType = $state('');

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let lastQuery = $state('');
	let queryDialog: HTMLDialogElement | undefined;
	let copySuccess = $state(false);

	function onInput() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(runSearch, 400);
	}

	// Re-run search when filters change while there is active search text
	$effect(() => {
		// touch reactive filter values
		filterDateFrom; filterDateTo; filterAccountType;
		if (searchText.trim().length >= 2) {
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(runSearch, 400);
		}
	});

	function buildQuery(text: string): string {
		const esc = text.replace(/"/g, '\\"');
		const conditions: string[] = [
			`(payee ~ "${esc}" OR narration ~ "${esc}" OR account ~ "${esc}")`
		];
		if (filterDateFrom) conditions.push(`date >= ${filterDateFrom}`);
		if (filterDateTo) conditions.push(`date <= ${filterDateTo}`);
		if (filterAccountType) conditions.push(`account ~ "^${filterAccountType}:"`);

		return (
			`SELECT date, payee, narration, account, number, currency` +
			` WHERE ${conditions.join(' AND ')}` +
			` ORDER BY date DESC`
		);
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
		await tick();

		try {
			const bql = buildQuery(text);
			lastQuery = bql;
			const result = await fullLedgerService.query(bql);
			if (result.errors?.length > 0) {
				error = (result.errors[0] as { message: string }).message;
				templates = [];
			} else {
				templates = buildTemplates(result.columns ?? [], (result.rows ?? []) as unknown[][]);
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

		const dateIdx = columns.indexOf('date');
		const payeeIdx = columns.indexOf('payee');
		const narrationIdx = columns.indexOf('narration');
		const accountIdx = columns.indexOf('account');
		const numberIdx = columns.indexOf('number');
		const currencyIdx = columns.indexOf('currency');

		// Group raw rows into full transactions by (date, payee, narration)
		const txKeyOrder: string[] = [];
		const txMap = new Map<
			string,
			{ date: string; payee: string; narration: string; accounts: string[]; postings: Posting[] }
		>();

		for (const row of rows) {
			const date = String(row[dateIdx] ?? '');
			const payee = String(row[payeeIdx] ?? '');
			const narration = String(row[narrationIdx] ?? '');
			const account = String(row[accountIdx] ?? '');
			const numVal = row[numberIdx];
			const currency = String(row[currencyIdx] ?? '');

			const txKey = `${date}\0${payee}\0${narration}`;
			if (!txMap.has(txKey)) {
				txMap.set(txKey, { date, payee, narration, accounts: [], postings: [] });
				txKeyOrder.push(txKey);
			}

			const tx = txMap.get(txKey)!;
			const posting = new Posting();
			posting.account = account;
			posting.amount = typeof numVal === 'number' ? numVal : parseFloat(String(numVal));
			posting.currency = currency;
			tx.postings.push(posting);
			tx.accounts.push(account);
		}

		// Deduplicate across dates by (payee, narration, sorted-account-fingerprint)
		const seen = new Set<string>();
		const result: Xact[] = [];

		for (const txKey of txKeyOrder) {
			const tx = txMap.get(txKey)!;
			const fingerprint = `${tx.payee}\0${tx.narration}\0${[...tx.accounts].sort().join('\0')}`;
			if (seen.has(fingerprint)) continue;
			seen.add(fingerprint);

			const xact = new Xact();
			xact.date = tx.date;
			xact.payee = tx.payee;
			xact.note = tx.narration;
			xact.postings = tx.postings;
			result.push(xact);

			if (result.length >= MAX_RESULTS) break;
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
			clone.postings = postings.map((p) => {
				const posting = new Posting();
				posting.account = p.account;
				posting.amount = p.amount;
				posting.currency = p.currency;
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

<article class="flex h-screen flex-col">
	<Toolbar title="Quick Entry">
		{#snippet menuItems()}
			<ToolbarMenuItem text="Show Query" Icon={CodeIcon} onclick={() => queryDialog?.showModal()} />
		{/snippet}
	</Toolbar>

	<section class="flex flex-1 flex-col gap-3 overflow-y-auto touch-pan-y p-3">
		<!-- Search input -->
		<input
			class="input input-bordered w-full"
			type="search"
			placeholder="Search payee, narration, account…"
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

		<!-- Results -->
		{#if isLoading}
			<div class="flex justify-center py-8">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{:else if error}
			<div class="alert alert-error text-sm">{error}</div>
		{:else if searchText.trim().length < 2}
			<p class="py-8 text-center text-sm text-base-content/50">Type at least 2 characters to search.</p>
		{:else if hasSearched && templates.length === 0}
			<p class="py-8 text-center text-sm text-base-content/50">No matching transactions found.</p>
		{:else if templates.length > 0}
			{#if isSelecting}
				<div class="flex justify-center py-4">
					<span class="loading loading-spinner loading-md"></span>
				</div>
			{/if}
			<div class="flex flex-col divide-y divide-base-200" class:pointer-events-none={isSelecting} class:opacity-50={isSelecting}>
				{#each templates as template (template)}
					<div class="py-2">
						<JournalXactRow xact={template} onclick={selectTemplate} />
					</div>
				{/each}
			</div>
		{/if}
	</section>

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
</article>
