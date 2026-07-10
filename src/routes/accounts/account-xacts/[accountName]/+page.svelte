<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import TransactionList from '$lib/components/TransactionList.svelte';
	import type { AccountMeta } from './+page.js';
	import type { MetaValueJson } from '@rustledger/wasm';

	function formatMetaValue(value: MetaValueJson): string {
		if (value === null || value === undefined) return '';
		if (typeof value === 'string') return value;
		if (typeof value === 'boolean') return value ? 'true' : 'false';
		return `${value.number} ${value.currency}`;
	}
	import * as Formatter from '$lib/utils/formatter';
	import { ScaleIcon, CopyIcon, ActivityIcon } from '@lucide/svelte';

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text);
		Notifier.success('Copied to clipboard');
	}
	import Notifier from '$lib/utils/notifier';
	import { openXactDetails } from '$lib/utils/unifiedXacts';
</script>

<main class="flex h-screen flex-col">
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
			<ToolbarMenuItem
				Icon={ActivityIcon}
				text="Running Balance"
				onclick={() => goto(`/reports/running-balance?account=${encodeURIComponent(page.data.account.name)}`)}
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

		<TransactionList rows={page.data.unifiedRows} onRowClick={openXactDetails} />
	</section>
</main>
