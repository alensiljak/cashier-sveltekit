<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import AccordionSection from '$lib/components/AccordionSection.svelte';
	import QuickQueryResults from '$lib/components/QuickQueryResults.svelte';
	import { CopyIcon } from '@lucide/svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { buildQuery, type CommonOptions, type LotsOptions } from '$lib/services/quickQueryBuilder';
	import { parseQqrlCommand } from '$lib/services/quickQueryCliParser';

	const DEBOUNCE_MS = 400;

	// Auto-run has no "are you sure" step, so an unfiltered command (e.g. just
	// typing "r" before adding filters) must not be free to pull every
	// transaction in the ledger. balance is grouped/aggregated so it's exempt.
	const DEFAULT_AUTO_LIMIT = 100;

	let commandLine = $state('balance Assets -l 10')

	let parsed = $derived(parseQqrlCommand(commandLine))

	let limitAutoApplied = $derived(
		parsed.command != null &&
			parsed.command !== 'balance' &&
			(parsed.command === 'lots' ? parsed.lotsOpts.limit == null : parsed.commonOpts.limit == null)
	)

	let effectiveCommonOpts = $derived<CommonOptions>(
		limitAutoApplied && parsed.command !== 'lots'
			? { ...parsed.commonOpts, limit: DEFAULT_AUTO_LIMIT }
			: parsed.commonOpts
	)
	let effectiveLotsOpts = $derived<LotsOptions>(
		limitAutoApplied && parsed.command === 'lots'
			? { ...parsed.lotsOpts, limit: DEFAULT_AUTO_LIMIT }
			: parsed.lotsOpts
	)

	let bql = $derived(
		parsed.command ? buildQuery(parsed.command, effectiveCommonOpts, effectiveLotsOpts) : ''
	)
	let showRunningTotal = $derived(
		parsed.command === 'register' && parsed.commonOpts.total
	)

	// --- Results ---
	interface QueryError {
		message: string
		severity?: string
		line?: number
		column?: number
	}

	let columns = $state<string[]>([])
	let rows = $state<unknown[]>([])
	let queryErrors = $state<QueryError[]>([])
	let isRunning = $state(false)

	async function runQuery(queryBql: string) {
		isRunning = true
		try {
			await fullLedgerService.ensureLoaded()
			const result = await fullLedgerService.query(queryBql)
			const errs = (result?.errors ?? []) as QueryError[]
			if (errs.length === 0) {
				columns = result?.columns ?? []
				rows = result?.rows ?? []
				queryErrors = []
			} else {
				columns = []
				rows = []
				queryErrors = errs
			}
		} catch (e: unknown) {
			columns = []
			rows = []
			const msg = e instanceof Error ? e.message : String(e)
			queryErrors = [{ message: msg, severity: 'error' }]
		}
		isRunning = false
	}

	// --- Debounced auto-run whenever the command line (and thus the BQL) changes ---
	let debounceTimer: ReturnType<typeof setTimeout> | undefined

	$effect(() => {
		const currentBql = bql
		const parseErrors = parsed.errors

		if (debounceTimer) clearTimeout(debounceTimer)

		if (!currentBql) {
			columns = []
			rows = []
			queryErrors = parseErrors.map((message) => ({ message, severity: 'error' }))
			return
		}

		debounceTimer = setTimeout(() => {
			if (parseErrors.length > 0) {
				queryErrors = parseErrors.map((message) => ({ message, severity: 'warning' }))
			}
			runQuery(currentBql)
		}, DEBOUNCE_MS)

		return () => {
			if (debounceTimer) clearTimeout(debounceTimer)
		}
	})

	let legendExpanded = $state(false)

	let copied = $state(false)

	async function copyBql() {
		await navigator.clipboard.writeText(bql)
		copied = true
		setTimeout(() => (copied = false), 1500)
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && e.ctrlKey) {
			if (debounceTimer) clearTimeout(debounceTimer)
			if (bql) runQuery(bql)
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="flex flex-col flex-1">
	<Toolbar title="Quick Query (CLI)">
		{#snippet actions()}
			<HelpButton topic="quick-query" />
		{/snippet}
	</Toolbar>

	<div class="flex flex-col gap-4 p-4">
		<!-- Command line input -->
		<label class="form-control w-full">
			<div class="label py-1">
				<span class="label-text text-xs text-base-content/60">
					qqrl-style command (e.g. <code>balance Assets not Bank -b 2025-01 -e 2025-12 -c EUR</code>)
				</span>
			</div>
			<input
				type="text"
				class="input input-bordered input-sm w-full font-mono"
				placeholder="balance Assets -b 2025-01 -e 2025-12"
				bind:value={commandLine}
				autocomplete="off"
				spellcheck="false"
			/>
		</label>

		<!-- Parameter reference -->
		<AccordionSection
			title="Command reference"
			expanded={legendExpanded}
			onToggle={() => (legendExpanded = !legendExpanded)}
		>
			<div class="flex flex-col gap-4 text-xs">
				<div>
					<h3 class="font-semibold text-sm mb-1">Commands</h3>
					<table class="table table-xs w-full">
						<tbody>
							<tr>
								<td class="font-mono whitespace-nowrap">balance <span class="opacity-50">(b, bal)</span></td>
								<td>Account balances</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">register <span class="opacity-50">(r, reg)</span></td>
								<td>Transaction register</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">lots <span class="opacity-50">(l, lot)</span></td>
								<td>Investment lots and cost basis</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">assert <span class="opacity-50">(a)</span></td>
								<td>Balance assertions</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">price <span class="opacity-50">(p)</span></td>
								<td>Price history (commodity pattern instead of account)</td>
							</tr>
						</tbody>
					</table>
				</div>

				<div>
					<h3 class="font-semibold text-sm mb-1">Account / commodity pattern</h3>
					<table class="table table-xs w-full">
						<tbody>
							<tr>
								<td class="font-mono whitespace-nowrap">PATTERN...</td>
								<td>
									One or more space-separated patterns, e.g. <code>Assets not Bank @Payee</code>.
									<code>not</code> excludes matching accounts, <code>@text</code> filters by payee/narration.
								</td>
							</tr>
						</tbody>
					</table>
				</div>

				<div>
					<h3 class="font-semibold text-sm mb-1">
						Common options <span class="font-normal opacity-60">(balance, register, assert, price)</span>
					</h3>
					<table class="table table-xs w-full">
						<tbody>
							<tr>
								<td class="font-mono whitespace-nowrap">-b, --begin DATE</td>
								<td>Start date — <code>YYYY</code>, <code>YYYY-MM</code>, or <code>YYYY-MM-DD</code></td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">-e, --end DATE</td>
								<td>End date (exclusive)</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">-d, --date-range RANGE</td>
								<td>
									Range shorthand, e.g. <code>2025-01..2025-06</code>, <code>2025</code>, or
									<code>2025-08..</code>
								</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">-c, --currency CUR</td>
								<td>Currency filter, repeatable (<code>-c EUR -c USD</code>) or comma-separated</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">-X, --exchange CUR</td>
								<td>Convert all amounts to this currency</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">-S, --sort FIELD</td>
								<td>Sort field(s); prefix with <code>-</code> for descending, e.g. <code>-date</code></td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">-l, --limit N</td>
								<td>
									Limit number of results
									<span class="opacity-50">(<code>-l</code> is a shorthand added in this UI)</span>
								</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">-T, --total</td>
								<td>Show running total (register only)</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">-H, --hierarchy</td>
								<td>Show account hierarchy (balance only)</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">-Z, --zero</td>
								<td>Exclude zero balances (balance only)</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">-C, --closed</td>
								<td>Include closed accounts (balance only; hidden by default)</td>
							</tr>
						</tbody>
					</table>
				</div>

				<div>
					<h3 class="font-semibold text-sm mb-1">
						Lots-only options <span class="font-normal opacity-60">(in addition to begin/end/date-range/currency/exchange/sort/limit)</span>
					</h3>
					<table class="table table-xs w-full">
						<tbody>
							<tr>
								<td class="font-mono whitespace-nowrap">-s, --sort-by date|price|symbol</td>
								<td>Sort lots by field (used when <code>--sort</code> isn't set)</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">-A, --average</td>
								<td>Show average cost per symbol</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">--active</td>
								<td>Show only active/open lots (default)</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">--all</td>
								<td>Show all lots, including sold ones</td>
							</tr>
							<tr>
								<td class="font-mono whitespace-nowrap">--closed</td>
								<td>Show only closed/sold lots</td>
							</tr>
						</tbody>
					</table>
				</div>

				<p class="opacity-60">
					This UI runs the query automatically as you type, so if no
					<code>-l/--limit</code> is given, non-<code>balance</code> commands are capped at
					{DEFAULT_AUTO_LIMIT} rows to avoid loading the entire ledger on every keystroke.
					Add <code>-l N</code> to raise or remove the cap.
				</p>

				<p class="opacity-60">
					Not yet supported in this UI: <code>-a/--amount</code>, <code>query</code> command,
					<code>--ledger</code>, <code>--no-pager</code>, <code>--empty</code>, <code>--list</code>.
				</p>
			</div>
		</AccordionSection>

		<!-- BQL preview -->
		<div class="form-control w-full">
			<div class="flex items-center justify-between py-1">
				<span class="label-text text-xs text-base-content/60">Generated BQL</span>
				<button
					class="btn btn-ghost btn-xs gap-1"
					onclick={copyBql}
					title="Copy BQL to clipboard"
					disabled={!bql}
				>
					<CopyIcon size={14} />
					{#if copied}<span class="text-xs">Copied!</span>{/if}
				</button>
			</div>
			<textarea
				class="textarea textarea-bordered w-full font-mono text-xs h-20 resize-none"
				readonly
				value={bql}
			></textarea>
			{#if limitAutoApplied}
				<span class="text-xs text-base-content/40 mt-1">
					Auto-limited to {DEFAULT_AUTO_LIMIT} rows — add <code>-l N</code> to change.
				</span>
			{/if}
		</div>

		{#if isRunning}
			<div class="text-xs text-base-content/40 flex items-center gap-2">
				<span class="loading loading-spinner loading-xs"></span> Running…
			</div>
		{/if}

		<QuickQueryResults {columns} {rows} errors={queryErrors} {showRunningTotal} />
	</div>
</main>
