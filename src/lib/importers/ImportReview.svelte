<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import JournalXactRow from '$lib/components/JournalXactRow.svelte';
	import Notifier from '$lib/utils/notifier';
	import { findDuplicates } from './dedup';
	import { DEFAULT_DATE_WINDOW_DAYS } from './dedup';
	import { loadExistingBankXacts, loadIsinSymbols } from './existing';
	import { getXactStore } from '$lib/storage/xactStoreRegistry';
	import type { Importer } from './types';
	import type { Xact } from '$lib/data/model';

	interface Props {
		importer: Importer<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
		config: unknown;
		file: File;
		/** Called when the user cancels or the review cannot continue. */
		oncancel: () => void;
	}
	let { importer, config, file, oncancel }: Props = $props();

	type Row = { xact: Xact; duplicateOf?: Xact; duplicate: boolean; selected: boolean };

	let busy = $state(true);
	let error = $state('');
	let rows = $state<Row[]>([]);

	let selectedCount = $derived(rows.filter((r) => r.selected).length);
	let duplicateCount = $derived(rows.filter((r) => r.duplicate).length);

	onMount(load);

	function shiftDate(iso: string, days: number): string {
		const d = new Date(iso);
		d.setUTCDate(d.getUTCDate() + days);
		return d.toISOString().substring(0, 10);
	}

	async function load() {
		try {
			const text = await file.text();
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

			rows = findDuplicates(candidates, existing, account).map((r) => ({
				xact: r.xact,
				duplicateOf: r.duplicateOf,
				duplicate: !!r.duplicateOf,
				selected: !r.duplicateOf
			}));
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function accept() {
		busy = true;
		try {
			const store = await getXactStore();
			const ids = await store.appendMany(rows.filter((r) => r.selected).map((r) => r.xact));
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
		<p class="opacity-70">Reading {file.name}…</p>
	{/if}

	{#if rows.length > 0}
		<p class="text-sm">
			<span class="font-medium">{file.name}</span>: {rows.length} transactions,
			{duplicateCount} already recorded (unselected).
		</p>
		<div class="flex flex-col divide-y divide-base-300">
			{#each rows as row, i (i)}
				<label class="flex items-start gap-3 py-2 {row.duplicate ? 'opacity-60' : ''}">
					<input type="checkbox" class="checkbox checkbox-sm mt-1" bind:checked={row.selected} />
					<div class="flex-1 min-w-0">
						<JournalXactRow
							xact={row.xact}
							linksEnabled={false}
							badge={row.duplicate ? 'Duplicate' : null}
						/>
						{#if row.duplicateOf}
							<p class="pl-6 text-xs opacity-70">
								matches {row.duplicateOf.date}
								{row.duplicateOf.payee}{row.duplicateOf.note ? ` · ${row.duplicateOf.note}` : ''}
							</p>
						{/if}
					</div>
				</label>
			{/each}
		</div>
	{/if}

	{#if error}<p class="text-error text-sm">{error}</p>{/if}
</div>

<div class="flex gap-2 justify-end p-4 border-t border-base-300">
	<button class="btn" disabled={busy && rows.length > 0} onclick={oncancel}>Cancel</button>
	{#if rows.length > 0}
		<button class="btn btn-primary" disabled={busy || selectedCount === 0} onclick={accept}>
			Accept ({selectedCount})
		</button>
	{/if}
</div>
