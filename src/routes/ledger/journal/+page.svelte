<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { openXactDetails } from '$lib/utils/unifiedXacts';
	import { Xact, Posting } from '$lib/data/model';

	/** Rows link to Transaction Actions by default; ?readonly=1 disables that for a plain read-only view. */
	const linksEnabled = page.url.searchParams.get('readonly') !== '1';

	/** Target number of transactions to fetch per page. */
	const PAGE_SIZE = 30;
	/** Row (posting) budget for a page fetch — oversampled since one xact can span
	 *  several posting rows. Doubled on retry if a single xact exceeds it. */
	const INITIAL_ROW_LIMIT = 300;
	const MAX_ROW_LIMIT_ATTEMPTS = 4;

	type Cursor = { date: string; id: number };

	let isLoading = $state(false);
	let isLoadingMore = $state(false);
	let error = $state<string | null>(null);
	/** Ascending order: oldest first, newest last (mirrors the device journal). */
	let xacts = $state<Xact[]>([]);
	let hasMore = $state(true);
	let cursor: Cursor | null = null;

	let listContainer = $state<HTMLElement | null>(null);
	let topSentinel = $state<HTMLElement | null>(null);

	/** Groups posting rows into Xacts, preserving row order (newest-first per the query). */
	function groupRows(
		columns: string[],
		rows: unknown[][]
	): { xactsDesc: Xact[]; keyOrder: string[] } {
		const idIdx = columns.indexOf('id');
		const dateIdx = columns.indexOf('date');
		const flagIdx = columns.indexOf('flag');
		const payeeIdx = columns.indexOf('payee');
		const narrationIdx = columns.indexOf('narration');
		const accountIdx = columns.indexOf('account');
		const numberIdx = columns.indexOf('number');
		const currencyIdx = columns.indexOf('currency');

		const keyOrder: string[] = [];
		const groupMap = new Map<string, Xact>();

		for (const row of rows) {
			const txId = row[idIdx];
			const date = String(row[dateIdx] ?? '');
			const flag = String(row[flagIdx] ?? '*');
			const payee = String(row[payeeIdx] ?? '');
			const narration = String(row[narrationIdx] ?? '');
			const account = String(row[accountIdx] ?? '');
			const numVal = row[numberIdx];
			const currency = String(row[currencyIdx] ?? '');

			const key = txId != null ? String(txId) : `${date}\0${payee}\0${narration}`;
			if (!groupMap.has(key)) {
				const tx = new Xact();
				tx.id = typeof txId === 'number' ? txId : undefined;
				tx.date = date;
				tx.flag = flag;
				tx.payee = payee || narration;
				tx.note = payee ? narration : '';
				tx.postings = [];
				keyOrder.push(key);
				groupMap.set(key, tx);
			}

			const posting = new Posting();
			posting.account = account;
			posting.amount = typeof numVal === 'number' ? numVal : parseFloat(String(numVal));
			posting.currency = currency;
			groupMap.get(key)!.postings.push(posting);
		}

		return { xactsDesc: keyOrder.map((k) => groupMap.get(k)!), keyOrder };
	}

	/**
	 * Fetches one page older than `before` (or the most recent page when `before`
	 * is null), newest-first. Since LIMIT counts posting rows, not xacts, the
	 * last xact group in a full batch may be incomplete — it's dropped unless
	 * the batch came back short (proving there was nothing left to cut off).
	 */
	async function fetchPage(
		before: Cursor | null
	): Promise<{ xactsDesc: Xact[]; hasMore: boolean }> {
		let rowLimit = INITIAL_ROW_LIMIT;

		for (let attempt = 0; attempt < MAX_ROW_LIMIT_ATTEMPTS; attempt++) {
			let query = `SELECT id, date, flag, payee, narration, account, number, currency`;
			if (before) {
				query += ` WHERE (date < ${before.date}) OR (date = ${before.date} AND id < ${before.id})`;
			}
			query += ` ORDER BY date DESC, id DESC LIMIT ${rowLimit}`;

			const result = await fullLedgerService.query(query);
			const errs = result?.errors ?? [];
			if (errs.length > 0) {
				throw new Error((errs as { message: string }[]).map((e) => e.message).join('\n'));
			}

			const columns: string[] = result?.columns ?? [];
			const rows: unknown[][] = (result?.rows ?? []) as unknown[][];
			const { xactsDesc } = groupRows(columns, rows);

			const truncated = rows.length === rowLimit;
			if (!truncated) {
				return { xactsDesc, hasMore: false };
			}

			// Drop the possibly-incomplete last group.
			const complete = xactsDesc.slice(0, -1);
			if (complete.length > 0) {
				return { xactsDesc: complete, hasMore: true };
			}

			// A single xact's postings exceeded the row budget — widen and retry.
			rowLimit *= 4;
		}

		throw new Error('Unable to page the journal: a transaction has too many postings.');
	}

	async function loadInitial() {
		isLoading = true;
		error = null;
		await tick();
		try {
			await fullLedgerService.ensureLoaded();
			const page = await fetchPage(null);
			xacts = [...page.xactsDesc].reverse();
			hasMore = page.hasMore;
			const oldest = page.xactsDesc[page.xactsDesc.length - 1];
			cursor = oldest?.id != null ? { date: oldest.date ?? '', id: oldest.id } : null;
			if (!oldest) hasMore = false;

			isLoading = false;
			await tick();
			if (listContainer) listContainer.scrollTop = listContainer.scrollHeight;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			isLoading = false;
		}
	}

	async function loadMore() {
		if (isLoadingMore || isLoading || !hasMore || !cursor) return;
		isLoadingMore = true;
		try {
			const previousScrollHeight = listContainer?.scrollHeight ?? 0;
			const previousScrollTop = listContainer?.scrollTop ?? 0;

			const page = await fetchPage(cursor);
			const olderAscending = [...page.xactsDesc].reverse();
			xacts = [...olderAscending, ...xacts];
			hasMore = page.hasMore;
			const oldest = page.xactsDesc[page.xactsDesc.length - 1];
			cursor = oldest?.id != null ? { date: oldest.date ?? '', id: oldest.id } : null;
			if (!oldest) hasMore = false;

			await tick();
			if (listContainer) {
				listContainer.scrollTop = listContainer.scrollHeight - previousScrollHeight + previousScrollTop;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			hasMore = false; // stop retrying against a query that's failing
		} finally {
			isLoadingMore = false;
		}
	}

	loadInitial();

	$effect(() => {
		if (!topSentinel) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries[0].isIntersecting) loadMore();
		});
		observer.observe(topSentinel);
		return () => observer.disconnect();
	});

	async function onXactClick(xact: Xact) {
		await openXactDetails({
			date: xact.date ?? '',
			payee: xact.payee ?? '',
			narration: xact.note ?? '',
			amount: 0,
			currency: '',
			id: xact.id,
			isDevice: false,
		});
	}
</script>

<main class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Full Journal" />

	<section
		class="grow overflow-y-auto touch-pan-y px-2 py-2"
		bind:this={listContainer}
	>
		{#if isLoading}
			<div class="flex justify-center py-8">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{:else if error}
			<div class="rounded-lg border border-error bg-error/10 p-3 text-error text-sm font-mono">
				{error}
			</div>
		{:else if xacts.length === 0}
			<div class="py-8 text-center text-base-content/50 text-sm">No transactions found.</div>
		{:else}
			<div class="flex flex-col divide-y divide-base-200 mx-auto max-w-2xl">
				{#if hasMore}
					<div bind:this={topSentinel} class="py-4 text-center text-base-content/40 text-xs">
						{#if isLoadingMore}
							<span class="loading loading-spinner loading-sm"></span>
						{/if}
					</div>
				{/if}
				{#each xacts as xact (xact.id ?? (xact.date ?? '') + (xact.payee ?? ''))}
					<div class="py-2">
						<JournalXactRow {xact} onclick={onXactClick} {linksEnabled} />
					</div>
				{/each}
			</div>
		{/if}
	</section>
</main>
