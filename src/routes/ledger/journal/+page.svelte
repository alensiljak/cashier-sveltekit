<script lang="ts">
	import { tick, untrack } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { openXactDetails } from '$lib/utils/unifiedXacts';
	import { Xact, Posting } from '$lib/data/model';

	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let xacts = $state<Xact[]>([]);

	async function load() {
		isLoading = true;
		error = null;
		await tick();
		try {
			await fullLedgerService.ensureLoaded();
			const result = await fullLedgerService.query(
				'SELECT id, date, flag, payee, narration, account, number, currency ORDER BY date DESC'
			);
			const errs = result?.errors ?? [];
			if (errs.length > 0) {
				error = (errs as { message: string }[]).map((e) => e.message).join('\n');
				return;
			}

			const columns: string[] = result?.columns ?? [];
			const rows: unknown[][] = (result?.rows ?? []) as unknown[][];

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

			xacts = keyOrder.map((k) => groupMap.get(k)!);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}

	load();

	/** Progressive loading via IntersectionObserver */
	const PAGE_SIZE = 30;
	let visibleCount = $state(untrack(() => PAGE_SIZE));
	let sentinel = $state<HTMLElement | null>(null);

	$effect(() => {
		void xacts;
		visibleCount = PAGE_SIZE;
	});

	const visibleXacts = $derived(xacts.slice(0, visibleCount));

	$effect(() => {
		if (!sentinel) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries[0].isIntersecting && visibleCount < xacts.length) {
				visibleCount = Math.min(visibleCount + PAGE_SIZE, xacts.length);
			}
		});
		observer.observe(sentinel);
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

	<section class="grow overflow-y-auto touch-pan-y px-2 py-2">
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
				{#each visibleXacts as xact (xact.id ?? (xact.date ?? '') + (xact.payee ?? ''))}
					<div class="py-2 cursor-pointer">
						<JournalXactRow {xact} onclick={onXactClick} />
					</div>
				{/each}
			</div>
			<div bind:this={sentinel}></div>
			{#if visibleCount < xacts.length}
				<div class="py-4 text-center text-base-content/40 text-xs">
					{visibleCount} of {xacts.length}
				</div>
			{/if}
		{/if}
	</section>
</main>
