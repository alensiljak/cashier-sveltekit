<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import type { UnifiedXact, AccountMeta } from './+page.js';
	import type { MetaValueJson } from '@rustledger/wasm';

	function formatMetaValue(value: MetaValueJson): string {
		if (value === null || value === undefined) return '';
		if (typeof value === 'string') return value;
		if (typeof value === 'boolean') return value ? 'true' : 'false';
		return `${value.number} ${value.currency}`;
	}
	import * as Formatter from '$lib/utils/formatter';
	import { ScaleIcon, CopyIcon } from '@lucide/svelte';

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text);
		Notifier.success('Copied to clipboard');
	}
	import { xact, xactSpan } from '$lib/data/mainStore';
	import { Xact, Posting } from '$lib/data/model';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import Notifier from '$lib/utils/notifier';

	const PAGE_SIZE = 30;
	let visibleCount = $state(PAGE_SIZE);
	let sentinel = $state<HTMLElement | null>(null);

	async function onRowClick(row: UnifiedXact) {
		if (row.isDevice && row.xact && row.span) {
			xact.set(row.xact);
			xactSpan.set(row.span);
			await goto('/xact-actions');
			return;
		}

		// Read-only transaction: fetch postings from the full ledger
		const payeeClause = row.payee
			? `AND payee = "${row.payee.replace(/"/g, '\\"')}"`
			: `AND payee = ""`;
		const narrationClause = `AND narration = "${(row.narration ?? '').replace(/"/g, '\\"')}"`;
		const bql = `SELECT flag, account, number, currency WHERE date = ${row.date} ${payeeClause} ${narrationClause}`;

		const { columns, rows: postingRows, errors } = await fullLedgerService.query(bql);
		if (errors?.length) console.warn('Posting query errors:', errors);

		const safeRows = (postingRows ?? []) as unknown[][];
		if (!safeRows.length) {
			Notifier.error('Could not load transaction details');
			return;
		}

		const flagIdx = columns.indexOf('flag');
		const accountIdx = columns.indexOf('account');
		const numberIdx = columns.indexOf('number');
		const currencyIdx = columns.indexOf('currency');

		const xactObj = new Xact();
		xactObj.date = row.date;
		xactObj.payee = row.payee;
		xactObj.note = row.narration;
		xactObj.flag = (safeRows[0][flagIdx] as string) ?? '*';
		xactObj.postings = safeRows.map((pr) => {
			const p = new Posting();
			p.account = pr[accountIdx] as string;
			p.amount = parseFloat(pr[numberIdx] as string);
			p.currency = pr[currencyIdx] as string;
			return p;
		});

		xact.set(xactObj);
		xactSpan.set(undefined);
		await goto('/xact-actions');
	}

	const allRows = $derived(page.data.unifiedRows as UnifiedXact[]);
	const visibleRows = $derived(allRows.slice(0, visibleCount));

	$effect(() => {
		if (!sentinel) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries[0].isIntersecting && visibleCount < allRows.length) {
				visibleCount = Math.min(visibleCount + PAGE_SIZE, allRows.length);
			}
		});
		observer.observe(sentinel);
		return () => observer.disconnect();
	});
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Account Transactions">
		{#snippet actions()}
			<HelpButton topic="account-transactions" />
		{/snippet}
		{#snippet menuItems()}
			<ToolbarMenuItem
				Icon={ScaleIcon}
				text="Balance Adjustment"
				onclick={() => goto(`/accounts/bal-adj?account=${encodeURIComponent(page.data.account.name)}`)}
			/>
		{/snippet}
	</Toolbar>

	<section class="min-h-0 flex-1 overflow-y-auto space-y-2 p-1">
		<header>
			<p>{page.data.account.getParentName()}</p>
			<div class="flex flex-row text-2xl font-bold">
				<data class="grow">
					{page.data.account.getAccountName()}
				</data>
				<data class={`${Formatter.getAmountColour(page.data.total.quantity)}`}>
					{Formatter.formatAmount(page.data.total.quantity)}
					{page.data.total.currency}
				</data>
			</div>
			{#if Object.keys(page.data.accountMeta as AccountMeta).length > 0}
				<dl class="mt-2 space-y-0.5 text-sm">
					{#each Object.entries(page.data.accountMeta as AccountMeta) as [key, value]}
						<div class="flex gap-2 items-center">
							<dt class="text-base-content/50 shrink-0">{key}:</dt>
							<dd>{formatMetaValue(value)}</dd>
							<button
								class="text-base-content/40 hover:text-base-content/80 cursor-pointer"
								onclick={() => copyToClipboard(formatMetaValue(value))}
								aria-label="Copy {key}"
							>
								<CopyIcon size={14} />
							</button>
						</div>
					{/each}
				</dl>
			{/if}
		</header>

		{#if page.data.hasDeviceXacts}
			<div class="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
				<span class="inline-block h-3 w-1 rounded-sm bg-amber-400"></span>
				<span>Local records</span>
			</div>
		{/if}

		<!-- Double-line separator -->
		<div class="my-2 space-y-0.5">
			<hr class="border-gray-400" />
			<hr class="border-gray-400" />
		</div>

		<!-- Unified transaction list -->
		<div class="space-y-1">
			{#each visibleRows as row (row)}
				<div
					class="flex flex-row px-2 cursor-pointer {row.isDevice
						? 'border-l-2 border-amber-400 bg-amber-50/60 dark:bg-amber-950/25'
						: ''}"
					onclick={() => onRowClick(row)}
					onkeypress={() => onRowClick(row)}
					role="button"
					tabindex="0"
				>
					<data class="mr-4 shrink-0">{row.date}</data>
					<data class="grow">
						{row.payee}{#if row.payee && row.narration}<span class="opacity-50"> · {row.narration}</span>{:else if row.narration}{row.narration}{/if}
					</data>
					<data class="shrink-0 {Formatter.getAmountColour(row.amount)}">
						{Formatter.formatAmount(row.amount)}
						{row.currency}
					</data>
				</div>
			{/each}
			<div bind:this={sentinel}></div>
		</div>
	</section>
</article>
