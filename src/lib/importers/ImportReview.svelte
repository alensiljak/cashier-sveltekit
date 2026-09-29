<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronRightIcon } from '@lucide/svelte';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import Notifier from '$lib/utils/notifier';
	import { DEFAULT_DATE_WINDOW_DAYS, findDuplicates } from './dedup';
	import { loadExistingBankXacts, loadFullXact, loadIsinSymbols } from './existing';
	import { clearPendingImport, loadPendingImport, saveSelection } from './pendingImport';
	import { getXactStore } from '$lib/storage/xactStoreRegistry';
	import type { Importer } from './types';
	import type { Xact } from '$lib/data/model';

	interface Props {
		importer: Importer<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
		config: unknown;
		fileName: string;
		text: string;
		/** Called when the user cancels. */
		oncancel: () => void;
	}
	let { importer, config, fileName, text, oncancel }: Props = $props();

	type Row = { xact: Xact; matchedWith?: Xact; selected: boolean };

	let busy = $state(true);
	let error = $state('');
	let rows = $state<Row[]>([]);
	/** Full matched transactions for the rows the user expanded, by row index. */
	let expanded = $state<Record<number, Xact | 'loading'>>({});

	let selectedCount = $derived(rows.filter((r) => r.selected).length);
	let matchedCount = $derived(rows.filter((r) => r.matchedWith).length);

	onMount(load);

	// Remember the ticks, so they survive navigating away and back.
	$effect(() => {
		if (rows.length > 0) saveSelection(rows.map((r) => r.selected));
	});

	function shiftDate(iso: string, days: number): string {
		const d = new Date(iso);
		d.setUTCDate(d.getUTCDate() + days);
		return d.toISOString().substring(0, 10);
	}

	async function load() {
		try {
			if (!importer.identify(text)) {
				throw new Error(`This file does not look like a ${importer.name} export.`);
			}

			let isinToSymbol: Record<string, string> = {};
			try {
				isinToSymbol = await loadIsinSymbols();
			} catch (e) {
				Notifier.warning(
					`Could not read ISINs from the book (${e instanceof Error ? e.message : e}). Is the ledger loaded?`
				);
			}
			const candidates = importer.extract(text, config, { isinToSymbol });
			if (candidates.length === 0) throw new Error('The file contains no transactions.');

			const dates = candidates.map((x) => x.date ?? '').sort();
			const account = importer.account(config);

			let existing: Xact[] = [];
			try {
				existing = await loadExistingBankXacts(
					account,
					shiftDate(dates[0], -DEFAULT_DATE_WINDOW_DAYS),
					shiftDate(dates[dates.length - 1], DEFAULT_DATE_WINDOW_DAYS)
				);
			} catch (e) {
				Notifier.warning(
					`Could not check for duplicates (${e instanceof Error ? e.message : e}). Is the ledger loaded?`
				);
			}

			const saved = loadPendingImport()?.selection;
			const restore = saved?.length === candidates.length ? saved : undefined;
			rows = findDuplicates(candidates, existing, account).map((r, i) => ({
				xact: r.xact,
				matchedWith: r.duplicateOf,
				selected: restore ? restore[i] : !r.duplicateOf
			}));
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function toggleMatch(i: number) {
		if (i in expanded) {
			delete expanded[i];
			return;
		}
		const summary = rows[i].matchedWith;
		if (!summary) return;
		expanded[i] = 'loading';
		expanded[i] = await loadFullXact(summary);
	}

	async function accept() {
		busy = true;
		try {
			const store = await getXactStore();
			const ids = await store.appendMany(rows.filter((r) => r.selected).map((r) => r.xact));
			clearPendingImport();
			Notifier.success(`Imported ${ids.length} transactions into the working set.`);
			await goto('/journal');
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			busy = false;
		}
	}
</script>

<div class="flex-1 overflow-y-auto touch-pan-y p-4 flex flex-col gap-4">
	{#if busy && rows.length === 0 && !error}
		<p class="opacity-70">Reading {fileName}…</p>
	{/if}

	{#if rows.length > 0}
		<p class="text-sm">
			<span class="font-medium">{fileName}</span>: {rows.length} transactions,
			{matchedCount} matched with recorded ones.
		</p>
		<div class="flex flex-col divide-y divide-base-300">
			{#each rows as row, i (i)}
				<div class="flex items-start gap-3 py-2">
					<input
						type="checkbox"
						class="checkbox checkbox-primary checkbox-sm not-checked:bg-transparent mt-1"
						class:opacity-60={row.matchedWith && !row.selected}
						aria-label="Import this transaction"
						bind:checked={row.selected}
					/>
					<div class="flex-1 min-w-0">
						<div class={row.matchedWith && !row.selected ? 'opacity-60' : ''}>
							<JournalXactRow xact={row.xact} linksEnabled={false} />
						</div>

						{#if row.matchedWith}
							<button
								type="button"
								class="badge badge-info badge-sm mt-1 ml-6 gap-0.5 font-medium"
								aria-expanded={i in expanded}
								onclick={() => toggleMatch(i)}
							>
								Match
								<ChevronRightIcon
									size={12}
									class="transition-transform {i in expanded ? 'rotate-90' : ''}"
								/>
							</button>

							{#if i in expanded}
								<div class="ml-6 mt-1 rounded-box bg-base-200 p-2">
									{#if expanded[i] === 'loading'}
										<p class="text-xs opacity-70">Loading…</p>
									{:else}
										<JournalXactRow xact={expanded[i]} linksEnabled={false} />
									{/if}
								</div>
							{/if}
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if error}<p class="text-error text-sm">{error}</p>{/if}
</div>

<div class="flex gap-2 justify-end p-4 border-t border-base-300">
	<button class="btn" onclick={oncancel}>Cancel</button>
	{#if rows.length > 0}
		<button class="btn btn-primary" disabled={busy || selectedCount === 0} onclick={accept}>
			Accept ({selectedCount})
		</button>
	{/if}
</div>
