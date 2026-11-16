<script lang="ts">
	import Toolbar from '#lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '#lib/components/ToolbarMenuItem.svelte';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import type { BookPricePlan, CommodityPlanEntry } from '#lib/services/prices/bookPricePlan';
	import {
		downloadAllFromBook,
		downloadGroups,
		loadBookPlan,
		setCommodityIgnored,
		type BookDownloadResult
	} from '#lib/services/prices/bookPriceService';
	import { describeError } from '#lib/services/prices/priceDownloadService';
	import { getPriceProvider, listPriceProviders } from '#lib/services/prices/priceProviderRegistry';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import DownloadIcon from '@lucide/svelte/icons/download';

	let plan = $state<BookPricePlan | null>(null);
	let loading = $state(true);
	let running = $state(false);
	let error = $state<string | null>(null);
	let result = $state<BookDownloadResult | null>(null);

	const providerNames = new Map(listPriceProviders().map((p) => [p.id, p.name]));
	const ledgerVersion = fullLedgerService.version;

	const of = (state: CommodityPlanEntry['state']) =>
		plan?.entries.filter((e) => e.state === state) ?? [];
	const mapped = $derived(of('mapped'));
	const unmapped = $derived(of('unmapped-source'));
	const invalid = $derived(of('invalid'));
	const untagged = $derived(of('untagged'));
	const ignored = $derived(of('ignored'));
	/** Mapped, but served by a provider this mode does not download yet. */
	const unsupported = $derived(mapped.filter((e) => getPriceProvider(e.providerId!).kind !== 'fx'));
	const groups = $derived(plan ? downloadGroups(plan) : new Map<string, string[]>());
	const downloadCount = $derived([...groups.values()].reduce((n, g) => n + g.length, 0));

	// Re-plan whenever the ledger (re)loads, e.g. after a download.
	$effect(() => {
		void $ledgerVersion;
		void refresh();
	});
	onMount(refresh);

	async function refresh() {
		try {
			plan = await loadBookPlan();
			error = null;
		} catch (e) {
			error = describeError(e);
		}
		loading = false;
	}

	async function download() {
		running = true;
		error = null;
		result = null;
		try {
			result = await downloadAllFromBook(plan ?? undefined);
		} catch (e) {
			error = describeError(e);
		}
		running = false;
	}

	async function toggleIgnored(commodity: string, value: boolean) {
		try {
			await setCommodityIgnored(commodity, value);
			await refresh();
		} catch (e) {
			error = describeError(e);
		}
	}
</script>

<Toolbar title="Book Prices">
	{#snippet menuItems()}
		<ToolbarMenuItem text="Price providers" Icon={SettingsIcon} targetNav="/prices/providers" />
		<!-- Interim entry to the per-provider download page, until its place is decided. -->
		<ToolbarMenuItem text="Provider download" Icon={DownloadIcon} targetNav="/prices/download" />
	{/snippet}
</Toolbar>

<main class="flex flex-col flex-1">
	<div class="flex flex-col gap-4 p-4 mx-auto max-w-2xl w-full">
		<p class="text-sm opacity-70">
			Prices for commodities tagged with a Beancount <code>price</code> meta, downloaded through the
			providers mapped to their sources. Currencies only for now.
		</p>

		{#if error}
			<div class="alert alert-error text-sm"><span>{error}</span></div>
		{/if}

		{#if loading}
			<span class="loading loading-spinner loading-sm"></span>
		{:else if plan}
			<!-- Providers in the full download -->
			<section class="card bg-base-100 shadow-sm">
				<div class="card-body gap-2 p-4">
					<div class="flex items-center gap-2">
						<h2 class="card-title text-base flex-1">Providers</h2>
						<button class="btn btn-ghost btn-xs rounded" onclick={() => goto('/prices/providers')}>
							Manage
						</button>
					</div>
					<ul class="flex flex-col gap-2">
						{#each plan.providers as p (p.providerId)}
							<li class="flex items-center gap-2 text-sm">
								<span class="flex-1">{providerNames.get(p.providerId)}</span>
								{#if p.included}
									<span class="badge badge-success badge-sm">
										{p.commodities.length} commodit{p.commodities.length === 1 ? 'y' : 'ies'}
									</span>
								{:else}
									<span class="badge badge-ghost badge-sm">not included</span>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			</section>

			<!-- Download -->
			<section class="card bg-base-100 shadow-sm">
				<div class="card-body gap-2 p-4">
					<h2 class="card-title text-base">Download</h2>
					{#each groups as [providerId, symbols] (providerId)}
						<p class="text-sm">
							<span class="font-medium">{providerNames.get(providerId)}:</span>
							{symbols.join(', ')}
						</p>
					{/each}
					{#if groups.size === 0}
						<p class="text-sm opacity-60">Nothing mapped to download.</p>
					{/if}
					<button
						class="btn btn-primary btn-sm rounded self-start"
						type="button"
						disabled={running || downloadCount === 0}
						onclick={download}
					>
						{#if running}<span class="loading loading-spinner loading-xs"></span>{:else}<DownloadIcon
								size={16}
							/>{/if}
						Download all
					</button>
					{#if result}
						<div class="alert alert-success text-sm">
							<span>
								{#if result.unchanged}
									Already up to date.
								{:else}
									Wrote {result.added} new, {result.updated} updated
								{/if}
								({result.directives} price{result.directives === 1 ? '' : 's'} in
								<code>{result.targetFile}</code>).
								{#each result.providers.filter((p) => p.missing.length) as p (p.providerId)}
									<br />Missing from {providerNames.get(p.providerId)}: {p.missing.join(', ')}.
								{/each}
							</span>
						</div>
					{/if}
				</div>
			</section>

			{#snippet group(title: string, rows: CommodityPlanEntry[], hint: string)}
				{#if rows.length > 0}
					<!-- Short lists start open; long ones start collapsed. -->
					<details
						class="collapse collapse-arrow bg-base-100 shadow-sm"
						open={rows.length <= 5}
					>
						<summary class="collapse-title text-base font-semibold">
							{title} ({rows.length})
						</summary>
						<div class="collapse-content flex flex-col gap-2">
							<p class="text-xs opacity-60">{hint}</p>
							<ul class="flex flex-col gap-1">
								{#each rows as e (e.commodity)}
									<li class="flex items-center gap-2 text-sm">
										<span class="font-medium">{e.commodity}</span>
										<span class="flex-1 text-xs opacity-60 break-all">
											{e.reason ?? (e.source ? `source: ${e.source}` : '')}
										</span>
										{#if e.state === 'untagged'}
											<button
												class="btn btn-ghost btn-xs rounded"
												onclick={() => toggleIgnored(e.commodity, true)}>Ignore</button
											>
										{:else if e.state === 'ignored'}
											<button
												class="btn btn-ghost btn-xs rounded"
												onclick={() => toggleIgnored(e.commodity, false)}>Unignore</button
											>
										{/if}
									</li>
								{/each}
							</ul>
						</div>
					</details>
				{/if}
			{/snippet}

			{@render group(
				'Untagged',
				untagged,
				'No price tag, so no prices are downloaded. Tag the commodity in the book, or ignore it if that is intended.'
			)}
			{@render group(
				'Unmapped source',
				unmapped,
				'The price tag names a source with no provider. Map it in the provider settings (and check the provider is switched on).'
			)}
			{@render group('Invalid', invalid, 'The price tag is malformed or the provider rejected it.')}
			{@render group(
				'Not downloaded yet',
				unsupported,
				'Mapped to a provider that this mode does not download yet (currencies only).'
			)}

			{#if ignored.length > 0}
				<details class="collapse collapse-arrow bg-base-100 shadow-sm">
					<summary class="collapse-title text-base font-semibold">
						Ignored ({ignored.length})
					</summary>
					<div class="collapse-content">
						<ul class="flex flex-col gap-1">
							{#each ignored as e (e.commodity)}
								<li class="flex items-center gap-2 text-sm">
									<span class="flex-1 font-medium">{e.commodity}</span>
									<button
										class="btn btn-ghost btn-xs rounded"
										onclick={() => toggleIgnored(e.commodity, false)}>Unignore</button
									>
								</li>
							{/each}
						</ul>
					</div>
				</details>
			{/if}
		{/if}
	</div>
</main>
