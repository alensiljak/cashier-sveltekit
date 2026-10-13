<script lang="ts">
	import { FileUpIcon, PlusIcon, ScrollIcon } from '@lucide/svelte';
	import CashierCardTemplate from './CashierCardTemplate.svelte';
	import XactSummaryLine from './XactSummaryLine.svelte';
	import { goto } from '$app/navigation';
	import { xact } from '#lib/data/mainStore';
	import { Money, Posting, Xact } from '#lib/data/model';
	import { XactAugmenter } from '#lib/utils/xactAugmenter';
	import Notifier from '#lib/utils/notifier';
	import { formatAmount, getReadableDate, getXactAmountColour } from '#lib/utils/formatter';
	import { getXactStore, subscribeXactStore } from '#lib/storage/xactStoreRegistry';
	import { homeCache } from '#lib/services/homeCache';
	import { ShortDateFormatStore } from '#lib/data/mainStore';

	Notifier.init();

	function cachedEntriesToState(): { xacts: Xact[]; amounts: Money[] } {
		const entries = homeCache.getJournalEntries();
		if (!entries) return { xacts: [], amounts: [] };
		const xacts = entries.map((e) => {
			const tx = new Xact();
			tx.date = e.date;
			tx.payee = e.payee;
			tx.note = e.note;
			tx.flag = e.flag;
			tx.postings = e.postings.map((p) => {
				const posting = new Posting();
				posting.account = p.account;
				posting.amount = p.amount;
				posting.currency = p.currency;
				return posting;
			});
			return tx;
		});
		const amounts = entries.map((e) => {
			const m = new Money();
			m.quantity = e.xactAmount.quantity ?? 0;
			m.currency = e.xactAmount.currency;
			return m;
		});
		return { xacts, amounts };
	}

	const _initial = cachedEntriesToState();
	let xacts: Xact[] = $state(_initial.xacts);
	let xactBalances: Money[] = $state(_initial.amounts);

	let isLoading = $state(false);

	$effect(() => {
		loadData();
		return subscribeXactStore(loadData);
	});

	/**
	 * Return the colour to use for the amount.
	 * @param i Index of the Xact in the list.
	 */
	function getXactColour(i: number) {
		if (!xactBalances[i].quantity) return '';

		const xact = xacts[i];
		const balance = xactBalances[i];

		const colour = getXactAmountColour(xact, balance);

		return colour;
	}

	async function loadData() {
		isLoading = true;

		try {
			// The store lists records in date order; take the last 5, newest first.
			const stored = await (await getXactStore()).list();
			const newXacts = stored
				.slice(-5)
				.reverse()
				.map((s) => s.xact);
			if (newXacts.length === 0) {
				xacts = [];
				xactBalances = [];
				return;
			}

			const newAmounts = XactAugmenter.calculateXactAmounts(newXacts);
			// Assign both together so the template never sees mismatched arrays.
			xacts = newXacts;
			xactBalances = [...newAmounts];

			homeCache.saveJournalEntries(
				newXacts.map((tx, i) => ({
					date: tx.date ?? '',
					payee: tx.payee ?? '',
					note: tx.note ?? '',
					flag: tx.flag ?? '*',
					postings: tx.postings.map((p) => ({
						account: p.account,
						amount: p.amount ?? 0,
						currency: p.currency ?? ''
					})),
					xactAmount: {
						quantity: newAmounts[i]?.quantity ?? null,
						currency: newAmounts[i]?.currency ?? ''
					}
				}))
			);
		} catch (error: any) {
			console.error(error);
			Notifier.error(error.message);
		} finally {
			isLoading = false;
		}
	}

	async function onClick() {
		await goto('/journal');
	}

	async function onExportClick(e: Event) {
		e.stopPropagation();
		await goto('/export/journal');
	}

	async function onNewXactClick(e: Event) {
		e.stopPropagation();
		xact.set(Xact.create());
		await goto('/tx');
	}
</script>

<CashierCardTemplate onclick={onClick}>
	{#snippet icon()}
		<ScrollIcon />
	{/snippet}
	{#snippet title()}
		Device Journal
		{#if isLoading}<span class="loading loading-spinner loading-xs ml-2 opacity-70"></span>{/if}
	{/snippet}
	{#snippet content()}
		{#if xacts.length == 0}
			<p>The device journal is empty</p>
		{:else}
			<div class="container text-base">
				{#each xacts as xact, index (index)}
					<div class="border-base-content/15 flex border-b py-1">
						<XactSummaryLine
							date={getReadableDate(xact.date ?? '', $ShortDateFormatStore)}
							payee={xact.payee}
							note={xact.note}
							flag={xact.flag}
							amount={formatAmount(xactBalances[index].quantity, 2)}
							currency={xactBalances[index].currency}
							amountClass={getXactColour(index)}
						/>
					</div>
				{/each}
			</div>
		{/if}
	{/snippet}
	{#snippet footer()}
		<center class="flex justify-center gap-2">
			<button
				type="button"
				class="btn btn-outline btn-primary uppercase"
				onclick={onNewXactClick}
			>
				<PlusIcon />
				<span>New</span>
			</button>
			<button
				type="button"
				class="btn btn-outline btn-warning uppercase"
				onclick={onExportClick}
			>
				<FileUpIcon />
				<span>Export</span>
			</button>
		</center>
	{/snippet}
</CashierCardTemplate>
