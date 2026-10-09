<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronRightIcon } from '@lucide/svelte';
	import JournalXactRow from '#lib/components/JournalXactRow.svelte';
	import Notifier from '#lib/utils/notifier';
	import { DEFAULT_DATE_WINDOW_DAYS, findDuplicates } from './dedup';
	import { loadExistingBankXacts, loadFullXact, loadIsinSymbols } from './existing';
	import { clearPendingImport, loadPendingImport, saveSelection, saveView } from './pendingImport';
	import { getXactStore } from '#lib/storage/xactStoreRegistry';
	import type { Importer } from './types';
	import type { Xact } from '#lib/data/model';

	interface Props {
		importer: Importer<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
		config: unknown;
		fileName: string;
		text: string;
		/** Called when the user cancels. */
		oncancel: () => void;
	}
	let { importer, config, fileName, text, oncancel }: Props = $props();

	type Row = {
		xact: Xact;
		details: [string, string][];
		matchText: string[];
		appliedRules: number[];
		matchedWith?: Xact;
		selected: boolean;
	};

	let busy = $state(true);
	let error = $state('');
	let rows = $state<Row[]>([]);
	/** Full matched transactions for the rows whose Match pane is open, by row index. */
	let matchOpen = $state<Record<number, Xact | 'loading'>>({});
	let detailsOpen = $state<Record<number, boolean>>({});
	/** Off shows the raw records, as the bank sent them. */
	let applyRules = $state(true);
	/** Hides the rows that match a recorded transaction, leaving what is new. */
	let unmatchedOnly = $state(false);
	let scroller: HTMLDivElement;

	let isinToSymbol: Record<string, string> = {};

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

			try {
				isinToSymbol = await loadIsinSymbols();
			} catch (e) {
				Notifier.warning(
					`Could not read ISINs from the book (${e instanceof Error ? e.message : e}). Is the ledger loaded?`
				);
			}
			const imported = importer.extract(text, config, { isinToSymbol, applyRules });
			if (imported.length === 0) throw new Error('The file contains no transactions.');

			const dates = imported.map((r) => r.xact.date ?? '').sort();
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

			const matches = findDuplicates(
				imported.map((r) => r.xact),
				existing,
				account
			);
			const pending = loadPendingImport();
			const restore =
				pending?.selection?.length === imported.length ? pending.selection : undefined;
			rows = imported.map((r, i) => ({
				...r,
				appliedRules: r.appliedRules ?? [],
				matchedWith: matches[i].duplicateOf,
				selected: restore ? restore[i] : !matches[i].duplicateOf
			}));
			busy = false;

			if (pending?.view) await restoreView(pending.view);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	/** Reopens the panes and scroll position as they were when the user left for the rule page. */
	async function restoreView(view: NonNullable<ReturnType<typeof loadPendingImport>>['view']) {
		if (!view) return;
		unmatchedOnly = view.unmatchedOnly ?? false;
		for (const i of view.detailsOpen) if (i < rows.length) detailsOpen[i] = true;
		await Promise.all(view.matchOpen.filter((i) => i < rows.length).map((i) => toggleMatch(i)));
		await tick();
		scroller.scrollTop = view.scrollTop;
	}

	/** Re-reads the file with the current rules setting. Rows keep their position, ticks and matches. */
	function reextract() {
		const imported = importer.extract(text, config, { isinToSymbol, applyRules });
		if (imported.length !== rows.length) return;
		imported.forEach((r, i) => {
			rows[i].xact = r.xact;
			rows[i].details = r.details;
			rows[i].matchText = r.matchText;
			rows[i].appliedRules = r.appliedRules ?? [];
		});
	}

	async function toggleMatch(i: number) {
		if (i in matchOpen) {
			delete matchOpen[i];
			return;
		}
		const summary = rows[i].matchedWith;
		if (!summary) return;
		matchOpen[i] = 'loading';
		matchOpen[i] = await loadFullXact(summary);
	}

	function toggleDetails(i: number) {
		if (detailsOpen[i]) delete detailsOpen[i];
		else detailsOpen[i] = true;
	}

	/** Opens the rule page for a new rule, or, with `rule`, for editing the rule at that position. */
	async function openRule(i: number, rule?: number) {
		saveView({
			matchOpen: Object.keys(matchOpen).map(Number),
			detailsOpen: Object.keys(detailsOpen).map(Number),
			scrollTop: scroller.scrollTop,
			unmatchedOnly
		});
		await goto(`/importers/rule?row=${i}${rule === undefined ? '' : `&rule=${rule}`}`);
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

<div bind:this={scroller} class="flex-1 overflow-y-auto touch-pan-y p-4 flex flex-col gap-4">
	{#if busy && rows.length === 0 && !error}
		<p class="opacity-70">Reading {fileName}…</p>
	{/if}

	{#if rows.length > 0}
		<div class="flex items-center justify-between gap-3 flex-wrap">
			<p class="text-sm">
				<span class="font-medium">{fileName}</span>: {rows.length} transactions,
				{matchedCount} matched with recorded ones.
			</p>
			<div class="flex items-center gap-4 flex-wrap">
				{#if matchedCount > 0}
					<label class="flex items-center gap-2 text-sm cursor-pointer">
						<input
							type="checkbox"
							class="toggle toggle-primary toggle-sm bg-transparent bg-none"
							bind:checked={unmatchedOnly}
						/>
						Unmatched only
					</label>
				{/if}
				{#if importer.usesRules}
					<label class="flex items-center gap-2 text-sm cursor-pointer">
						<input
							type="checkbox"
							class="toggle toggle-primary toggle-sm bg-transparent bg-none"
							bind:checked={applyRules}
							onchange={reextract}
						/>
						Apply rules
					</label>
				{/if}
			</div>
		</div>

		<div class="flex flex-col divide-y divide-base-300">
			{#each rows as row, i (i)}
				{#if !unmatchedOnly || !row.matchedWith}
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

							<div class="mt-1 ml-6 flex gap-2">
								{#if row.matchedWith}
									<button
										type="button"
										class="badge badge-info badge-sm gap-0.5 font-medium"
										aria-expanded={i in matchOpen}
										onclick={() => toggleMatch(i)}
									>
										Match
										<ChevronRightIcon
											size={12}
											class="transition-transform {i in matchOpen ? 'rotate-90' : ''}"
										/>
									</button>
								{/if}
								<button
									type="button"
									class="badge badge-outline badge-sm gap-0.5"
									aria-expanded={!!detailsOpen[i]}
									onclick={() => toggleDetails(i)}
								>
									Details
									<ChevronRightIcon
										size={12}
										class="transition-transform {detailsOpen[i] ? 'rotate-90' : ''}"
									/>
								</button>
							</div>

							{#if i in matchOpen}
								<div class="ml-6 mt-1 rounded-box bg-base-200 p-2">
									{#if matchOpen[i] === 'loading'}
										<p class="text-xs opacity-70">Loading…</p>
									{:else}
										<JournalXactRow xact={matchOpen[i]} linksEnabled={false} />
									{/if}
								</div>
							{/if}

							{#if detailsOpen[i]}
								<div class="ml-6 mt-1 rounded-box bg-base-200 p-2 text-xs">
									<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
										{#each row.details as [label, value] (label)}
											<dt class="opacity-60">{label}</dt>
											<dd class="break-words">{value}</dd>
										{/each}
									</dl>
									{#if importer.usesRules}
										<div class="mt-2 flex flex-wrap gap-2">
											{#each row.appliedRules as index (index)}
												<button class="btn btn-xs" onclick={() => openRule(i, index)}>
													Edit rule #{index + 1}
												</button>
											{/each}
											<button class="btn btn-xs" onclick={() => openRule(i)}>New rule…</button>
										</div>
									{/if}
								</div>
							{/if}
						</div>
					</div>
				{/if}
			{/each}
			{#if unmatchedOnly && matchedCount === rows.length}
				<p class="py-4 text-sm opacity-70">Every row matches a recorded transaction.</p>
			{/if}
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
