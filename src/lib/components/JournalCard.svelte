<script lang="ts">
	import { FileUpIcon, ScrollIcon, TriangleAlertIcon } from '@lucide/svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import { goto } from '$app/navigation';
	import { Money, Posting, Xact } from '$lib/data/model';
	import { XactAugmenter } from '$lib/utils/xactAugmenter';
	import Notifier from '$lib/utils/notifier';
	import { formatAmount, getReadableDate, getXactAmountColour } from '$lib/utils/formatter';
	import { ensureInitialized, createParsedLedger } from '$lib/services/rustledger';
	import { readFile } from '$lib/utils/opfslib';
	import { CASHIER_XACT_FILE } from '$lib/constants';
	import ledgerService from '$lib/services/ledgerService';

	Notifier.init();

	let xacts: Xact[] = $state([]);
	let xactBalances: Money[] = $state([]);

	const lsVersion = ledgerService.version;
	let isLoading = $state(false);

	$effect(() => {
		const _v = $lsVersion;
		loadData();
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
		xactBalances = [];

		try {
			await ensureInitialized();
			const source = (await readFile(CASHIER_XACT_FILE)) ?? '';
			if (!source.trim()) {
				xacts = [];
				return;
			}

			const ledger = createParsedLedger(source);
			if (!ledger) {
				xacts = [];
				return;
			}

			try {
				const directives: any[] = ledger.getDirectives();
				const txDirectives = directives.filter((d) => d.type === 'transaction');
				// Last 5, newest first
				const last5 = txDirectives.slice(-5).reverse();
				xacts = last5.map(directiveToXact);
			} finally {
				ledger.free();
			}

			const amounts = XactAugmenter.calculateXactAmounts(xacts);
			xactBalances.push(...amounts);
		} catch (error: any) {
			console.error(error);
			Notifier.error(error.message);
		} finally {
			isLoading = false;
		}
	}

	function directiveToXact(directive: any): Xact {
		const tx = new Xact();
		tx.date = directive.date;
		tx.payee = directive.payee ?? '';
		tx.note = directive.narration ?? '';
		tx.flag = directive.flag ?? '*';
		tx.postings = (directive.postings ?? []).map((p: any) => {
			const posting = new Posting();
			posting.account = p.account ?? '';
			if (p.units?.number != null) posting.amount = parseFloat(p.units.number);
			if (p.units?.currency) posting.currency = p.units.currency;
			return posting;
		});
		return tx;
	}

	async function onClick() {
		await goto('/journal');
	}

	async function onExportClick(e: Event) {
		e.stopPropagation();
		await goto('/export/journal');
	}
</script>

<HomeCardTemplate onclick={onClick}>
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
			<div class="container space-y-1 text-base">
				{#each xacts as xact, index (index)}
					<div class="border-base-content/15 flex space-x-2 border-b">
						<time class="opacity-60">
							{getReadableDate(xact.date)}
						</time>
						<div class="flex grow items-center gap-1">
							{#if xact.flag === '!'}
								<TriangleAlertIcon class="text-warning size-4 shrink-0" />
							{/if}
							{xact.payee}
						</div>
						<div class={`${getXactColour(index)}`}>
							{formatAmount(xactBalances[index].quantity)}
							{xactBalances[index].currency}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/snippet}
	{#snippet footer()}
		<center>
			<button
				type="button"
				class="btn btn-outline btn-warning uppercase rounded"
				onclick={onExportClick}
			>
				<FileUpIcon />
				<span>Export</span>
			</button>
		</center>
	{/snippet}
</HomeCardTemplate>
