<script lang="ts">
	import Toolbar from '#lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '#lib/components/ToolbarMenuItem.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import type { CommodityPlanEntry } from '#lib/services/prices/bookPricePlan';
	import {
		downloadAllFromBook,
		loadBookPlan,
		planBookDownload,
		setCommodityIgnored,
		type BookDownloadPlan,
		type BookDownloadResult
	} from '#lib/services/prices/bookPriceService';
	import type { BookPricePlan } from '#lib/services/prices/bookPricePlan';
	import {
		resolveConfig,
		saveConfig,
		validateTargetFile,
		isTargetIncluded,
		describeError,
		type PriceDownloadConfig
	} from '#lib/services/prices/priceDownloadService';
	import {
		getDisabledProviders,
		getSkippedProviders,
		setProviderEnabled,
		setProviderSkipped
	} from '#lib/services/prices/priceNicknames';
	import { listPriceProviders } from '#lib/services/prices/priceProviderRegistry';
	import demoDataService from '#lib/services/demoDataService';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { PRICES_DEFAULT_DESTINATION } from '#lib/constants';
	import { readFile } from '#lib/utils/opfslib';
	import { SettingKeys } from '#lib/settings';
	import { onMount, untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { disintegrate } from '#lib/utils/disintegrate';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	const providerNames = new Map(listPriceProviders().map((p) => [p.id, p.name]));
	const ledgerVersion = fullLedgerService.version;

	let config = $state<PriceDownloadConfig>({
		providerId: '',
		targetFile: PRICES_DEFAULT_DESTINATION,
		writeMode: 'overwrite',
		symbols: null
	});
	let plan = $state<BookPricePlan | null>(null);
	let downloadPlan = $state<BookDownloadPlan>({ groups: new Map(), uncovered: [] });
	let skipped = $state<Set<string>>(new Set());
	/** Providers switched off on their settings page. */
	let disabledIds = $state<Set<string>>(new Set());
	/** Providers whose commodity list is unfolded. */
	let expanded = $state<Set<string>>(new Set());
	let loaded = $state(false);
	let running = $state(false);
	let error = $state<string | null>(null);
	let result = $state<BookDownloadResult | null>(null);
	let targetError = $state<string | null>(null);
	/** Whether the main book includes the destination; null = unknown. */
	let included = $state<boolean | null>(null);
	/** Current contents of the destination file. */
	let written = $state<string | null>(null);
	/** Per-provider state of the current/last run. */
	let progress = $state<Record<string, 'pending' | 'fetching' | 'done' | 'failed'>>({});
	let writing = $state(false);
	let previewOpen = $state(false);
	let demoActive = $state(false);

	// ── Remembered open/closed state of the collapsible sections (per browser) ──
	const SECTIONS_KEY = 'prices.download.openSections';
	function loadSections(): Record<string, boolean> {
		try {
			return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}');
		} catch {
			return {};
		}
	}
	let openSections = $state<Record<string, boolean>>(loadSections());
	function rememberSection(key: string, open: boolean) {
		openSections[key] = open;
		try {
			localStorage.setItem(SECTIONS_KEY, JSON.stringify(openSections));
		} catch {
			/* storage unavailable — the state just isn't remembered */
		}
	}

	/** Whether switched-off providers are listed (hidden by default to keep the list short). */
	let showDisabled = $state(openSections.showDisabled ?? false);

	const of = (state: CommodityPlanEntry['state']) =>
		plan?.entries.filter((e) => e.state === state) ?? [];
	const unmapped = $derived(of('unmapped-source'));
	const invalid = $derived(of('invalid'));
	const untagged = $derived(of('untagged'));
	const ignored = $derived(of('ignored'));
	const groups = $derived(downloadPlan.groups);
	const uncovered = $derived(downloadPlan.uncovered);
	/** Providers that take part: at least one enabled nickname maps to them. */
	const activeProviders = $derived(plan?.providers.filter((p) => p.included) ?? []);
	/** What the download will fetch: ticked providers that serve something. */
	const selectedGroups = $derived([...groups].filter(([id]) => !skipped.has(id)));
	const selectedCount = $derived(selectedGroups.reduce((n, [, symbols]) => n + symbols.length, 0));
	const hasProblems = $derived(
		untagged.length + unmapped.length + invalid.length + uncovered.length > 0
	);

	// Re-plan whenever the ledger (re)loads, e.g. after a download.
	$effect(() => {
		void $ledgerVersion;
		if (loaded) void refresh();
	});

	// The picker's result arrives in the URL, which may land after mount on a
	// client-side navigation, so react to it rather than checking once.
	let configReady = $state(false);
	let appliedPickerValue: string | null = null;
	$effect(() => {
		const key = page.url.searchParams.get('settingKey');
		const value = page.url.searchParams.get('settingValue');
		const pathname = page.url.pathname;
		if (configReady) untrack(() => applyPickerReturn(key, value, pathname));
	});

	onMount(async () => {
		config = await resolveConfig();
		configReady = true;
		skipped = new Set(await getSkippedProviders());
		demoActive = await demoDataService.isDemoActive();
		await checkTarget();
		await refresh();
		loaded = true;
	});

	/** Monotonic token: a stale plan must not overwrite a newer one. */
	let request = 0;
	async function refresh() {
		const mine = ++request;
		try {
			const next = await loadBookPlan();
			const nextDownload = await planBookDownload(next);
			if (mine !== request) return;
			disabledIds = new Set(await getDisabledProviders());
			plan = next;
			downloadPlan = nextDownload;
			error = null;
		} catch (e) {
			if (mine === request) error = describeError(e);
		}
		await refreshWritten();
	}

	async function refreshWritten() {
		written = targetError ? null : ((await readFile(config.targetFile)) ?? null);
	}

	async function checkTarget() {
		targetError = await validateTargetFile(config.targetFile);
		included = targetError ? null : await isTargetIncluded(config.targetFile);
	}

	/** Persist a destination/mode change. */
	async function updateConfig(patch: Partial<PriceDownloadConfig>) {
		config = { ...config, ...patch };
		await saveConfig(config);
		await checkTarget();
		await refreshWritten();
	}

	/** The OPFS file picker hands the chosen path back via the URL. */
	function applyPickerReturn(key: string | null, value: string | null, pathname: string) {
		if (key !== SettingKeys.priceTargetFile || !value) return;
		if (appliedPickerValue === value) return;
		appliedPickerValue = value;
		config = { ...config, targetFile: value };
		void saveConfig(config);
		void checkTarget().then(refreshWritten);
		// goto (unlike shallow replaceState) is safe while the initial navigation is
		// still settling, and it actually updates the URL and `page.url`.
		void goto(pathname, { replaceState: true });
	}

	function pickTargetFile() {
		void goto(
			`/opfs/file-picker?returnSetting=${SettingKeys.priceTargetFile}&returnTo=${encodeURIComponent('/prices/download')}&allowNew=1&ext=.bean`
		);
	}

	async function toggleProvider(providerId: string, checked: boolean) {
		const next = new Set(skipped);
		if (checked) next.delete(providerId);
		else next.add(providerId);
		skipped = next;
		await setProviderSkipped(providerId, !checked);
	}

	async function selectAll(all: boolean) {
		const ids = [...groups.keys()];
		skipped = new Set(all ? [] : ids);
		await Promise.all(ids.map((id) => setProviderSkipped(id, !all)));
	}

	async function enableProvider(providerId: string) {
		try {
			await setProviderEnabled(providerId, true);
			await refresh();
		} catch (e) {
			error = describeError(e);
		}
	}

	function toggleShowDisabled() {
		showDisabled = !showDisabled;
		rememberSection('showDisabled', showDisabled);
	}

	function toggleExpanded(providerId: string) {
		const next = new Set(expanded);
		if (!next.delete(providerId)) next.add(providerId);
		expanded = next;
	}

	async function download() {
		running = true;
		error = null;
		result = null;
		writing = false;
		progress = Object.fromEntries(selectedGroups.map(([id]) => [id, 'pending' as const]));
		try {
			result = await downloadAllFromBook(
				plan ?? undefined,
				selectedGroups.map(([id]) => id),
				(event) => {
					if (event.step === 'writing') writing = true;
					else progress = { ...progress, [event.providerId]: event.step };
				}
			);
			await refreshWritten();
		} catch (e) {
			error = describeError(e);
		}
		writing = false;
		running = false;
	}

	function openPreview() {
		void refreshWritten();
		previewOpen = true;
	}

	/** True only while an Ignore/Unignore click is in flight, so rows explode on that
	 * click and not when the whole page is torn down on navigation. */
	let explodeRows = false;
	function rowExit(node: HTMLElement) {
		return explodeRows ? disintegrate(node) : { duration: 0 };
	}

	async function toggleIgnored(commodity: string, value: boolean) {
		// Move the row right away so its exit animation starts at the click; the
		// re-plan afterwards confirms (or corrects) the state.
		explodeRows = true;
		if (plan) {
			plan = {
				...plan,
				entries: plan.entries.map((e) =>
					e.commodity === commodity ? { ...e, state: value ? 'ignored' : 'untagged' } : e
				)
			};
		}
		try {
			await setCommodityIgnored(commodity, value);
			await refresh();
		} catch (e) {
			error = describeError(e);
		} finally {
			explodeRows = false;
		}
	}

</script>

<Toolbar title="Price Download">
	{#snippet actions()}
		<HelpButton topic="price-download" />
	{/snippet}
	{#snippet menuItems()}
		<ToolbarMenuItem
			text={showDisabled ? 'Hide disabled providers' : 'Show disabled providers'}
			Icon={showDisabled ? EyeOffIcon : EyeIcon}
			onclick={toggleShowDisabled}
		/>
	{/snippet}
</Toolbar>

<main class="flex flex-col flex-1">
	<div class="flex flex-col gap-4 p-4 mx-auto max-w-2xl w-full">
		{#if demoActive}
			<div class="alert alert-info text-sm">
				<span>
					Demo data is read-only reference data. The download still writes the destination file, but
					the demo book keeps serving its own fixture prices.
				</span>
			</div>
		{/if}

		{#if error}
			<div class="alert alert-error text-sm"><span>{error}</span></div>
		{/if}

		{#if !loaded}
			<span class="loading loading-spinner loading-sm"></span>
		{:else if plan}
			<!-- ── Providers ──────────────────────────────────────── -->
			<section class="card bg-base-100 shadow-sm">
				<div class="card-body gap-2 p-4">
					<div class="flex items-center gap-2">
						<h2 class="card-title text-base flex-1">Providers</h2>
						{#if groups.size > 1}
							<button
								type="button"
								class="btn btn-ghost btn-xs rounded"
								onclick={() => void selectAll(true)}>All</button
							>
							<button
								type="button"
								class="btn btn-ghost btn-xs rounded"
								onclick={() => void selectAll(false)}>None</button
							>
						{/if}
					</div>

					<ul class="flex flex-col divide-y divide-base-200">
						{#each activeProviders as p (p.providerId)}
							{@const symbols = groups.get(p.providerId) ?? []}
							{@const open = expanded.has(p.providerId)}
							<li class="py-1.5">
								<div class="flex items-center gap-2">
									<input
										type="checkbox"
										class="checkbox checkbox-sm checkbox-success"
										aria-label="Download {providerNames.get(p.providerId)}"
										disabled={symbols.length === 0}
										checked={symbols.length > 0 && !skipped.has(p.providerId)}
										onchange={(e) => void toggleProvider(p.providerId, e.currentTarget.checked)}
									/>
									<button
										type="button"
										class="flex flex-1 items-center gap-1 text-left text-sm min-w-0"
										aria-expanded={open}
										disabled={symbols.length === 0}
										onclick={() => toggleExpanded(p.providerId)}
									>
										<ChevronRightIcon
											size={14}
											class="shrink-0 transition-transform {open ? 'rotate-90' : ''} {symbols.length ===
											0
												? 'opacity-30'
												: ''}"
										/>
										<span class="truncate">{providerNames.get(p.providerId)}</span>
									</button>
									{#if progress[p.providerId] === 'fetching'}
										<span class="loading loading-spinner loading-xs" aria-label="Fetching"></span>
									{:else if progress[p.providerId] === 'done'}
										<span class="badge badge-sm badge-success" title="Fetched">✓ {symbols.length}</span>
									{:else if progress[p.providerId] === 'failed'}
										<span class="badge badge-sm badge-error" title="Failed">✕</span>
									{:else if progress[p.providerId] === 'pending'}
										<span class="badge badge-sm badge-ghost">waiting</span>
									{:else}
										<span
											class="badge badge-sm {symbols.length > 0 ? 'badge-success' : 'badge-ghost'}"
										>
											{symbols.length}
										</span>
									{/if}
									<button
										type="button"
										class="btn btn-ghost btn-xs btn-circle"
										aria-label="Settings for {providerNames.get(p.providerId)}"
										onclick={() => goto(`/prices/providers/${p.providerId}`)}
									>
										<SettingsIcon size={16} />
									</button>
								</div>
								{#if open}
									<p class="pl-12 pt-1 text-xs opacity-70 break-words">{symbols.join(', ')}</p>
								{/if}
							</li>
						{/each}
						<!-- Enabled but unmapped providers always show; disabled ones only on request. -->
						{#each plan.providers.filter((p) => !p.included && (showDisabled || !disabledIds.has(p.providerId))) as p (p.providerId)}
							{@const off = disabledIds.has(p.providerId)}
							<li class="flex items-center gap-2 py-1.5">
								{#if off}
									<input
										type="checkbox"
										class="toggle toggle-success toggle-sm bg-transparent bg-none"
										aria-label="Enable {providerNames.get(p.providerId)}"
										checked={false}
										onchange={() => void enableProvider(p.providerId)}
									/>
								{:else}
									<span class="w-8"></span>
								{/if}
								<span class="flex-1 truncate text-sm opacity-60">
									{providerNames.get(p.providerId)}
								</span>
								<span class="text-xs opacity-60">{off ? 'disabled' : 'not mapped'}</span>
								<button
									type="button"
									class="btn btn-ghost btn-xs btn-circle"
									aria-label="Settings for {providerNames.get(p.providerId)}"
									onclick={() => goto(`/prices/providers/${p.providerId}`)}
								>
									<SettingsIcon size={16} />
								</button>
							</li>
						{/each}
					</ul>
				</div>
			</section>

			<!-- ── Destination + mode ─────────────────────────────── -->
			<section class="card bg-base-100 shadow-sm">
				<div class="card-body gap-3 p-4">
					<div class="flex items-center gap-3">
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium">Destination file</p>
							<p class="truncate text-xs opacity-60">{config.targetFile}</p>
						</div>
						<div class="flex shrink-0 items-center gap-1">
							{#if config.targetFile !== PRICES_DEFAULT_DESTINATION}
								<button
									type="button"
									class="btn btn-ghost btn-xs rounded"
									onclick={() => void updateConfig({ targetFile: PRICES_DEFAULT_DESTINATION })}
								>
									Default
								</button>
							{/if}
							<button class="btn btn-primary btn-xs rounded" type="button" onclick={pickTargetFile}>
								Select
							</button>
						</div>
					</div>
					{#if targetError}
						<p class="text-xs text-error">{targetError}</p>
					{:else if included === false && !demoActive}
						<p class="text-xs text-warning">
							Your main book has no <code>include "{config.targetFile}"</code> line, so these prices will
							have no effect until you add one.
						</p>
					{/if}

					<div class="flex items-center justify-between gap-3">
						<div class="flex-1">
							<p class="text-sm font-medium">Append history</p>
							<p class="text-xs opacity-60">
								{#if config.writeMode === 'append'}
									New fixing dates are added; earlier downloaded prices are kept.
								{:else}
									Off — the file is rewritten with only the latest prices of the selected providers.
								{/if}
							</p>
						</div>
						<input
							type="checkbox"
							class="toggle toggle-success bg-transparent bg-none"
							aria-label="Append history"
							checked={config.writeMode === 'append'}
							onchange={(e) =>
								void updateConfig({ writeMode: e.currentTarget.checked ? 'append' : 'overwrite' })}
						/>
					</div>

					<button
						class="btn btn-primary"
						type="button"
						disabled={running || !!targetError || selectedCount === 0}
						onclick={() => void download()}
					>
						{#if running}
							<span class="loading loading-spinner loading-sm"></span>
						{:else}
							<DownloadIcon size={16} />
						{/if}
						{#if running}
							{writing ? 'Writing file…' : 'Downloading…'}
						{:else if selectedCount === 0}
							Nothing selected
						{:else}
							Download {selectedCount} price{selectedCount === 1 ? '' : 's'}
							<span class="opacity-70 font-normal">
								· {selectedGroups.length} provider{selectedGroups.length === 1 ? '' : 's'}
							</span>
						{/if}
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
					{#if written !== null && !targetError}
						<button type="button" class="btn btn-ghost btn-sm rounded self-start" onclick={openPreview}>
							<EyeIcon size={16} /> Preview output file
						</button>
					{/if}
				</div>
			</section>

			<!-- ── Details (collapsed by default, remembered) ─────── -->
			{#snippet section(
				key: string,
				title: string,
				count: number,
				hint: string,
				rows: { commodity: string; note?: string; action?: 'ignore' | 'unignore' }[]
			)}
				{#if count > 0}
					<details
						class="collapse collapse-arrow bg-base-100 shadow-sm"
						open={openSections[key] ?? false}
						ontoggle={(e) => rememberSection(key, e.currentTarget.open)}
					>
						<summary class="collapse-title text-base font-semibold">{title} ({count})</summary>
						<div class="collapse-content flex flex-col gap-2">
							{#if hint}<p class="text-xs opacity-60">{hint}</p>{/if}
							<ul class="flex flex-col">
								{#each rows as r (r.commodity)}
									<li
										class="flex items-center gap-2 rounded px-2 py-1.5 text-sm even:bg-base-200"
										out:rowExit|global
										in:fade|global={{ duration: 250 }}
									>
										<span class="font-medium">{r.commodity}</span>
										<span class="flex-1 text-xs opacity-60 break-all">{r.note ?? ''}</span>
										{#if r.action}
											<button
												class="btn btn-ghost btn-xs rounded"
												onclick={() => toggleIgnored(r.commodity, r.action === 'ignore')}
											>
												{r.action === 'ignore' ? 'Ignore' : 'Unignore'}
											</button>
										{/if}
									</li>
								{/each}
							</ul>
						</div>
					</details>
				{/if}
			{/snippet}

			{#if hasProblems}
				<p class="-mb-2 text-xs font-medium uppercase tracking-wide opacity-50">Needs attention</p>
			{/if}
			{@render section(
				'untagged',
				'Untagged',
				untagged.length,
				'No price tag, so no prices are downloaded. Tag the commodity in the book, or ignore it if that is intended.',
				untagged.map((e) => ({ commodity: e.commodity, action: 'ignore' as const }))
			)}
			{@render section(
				'unmapped',
				'Unmapped source',
				unmapped.length,
				'The price tag names a source with no provider. Add the nickname in a provider’s settings (gear icon above) and check the provider is switched on.',
				unmapped.map((e) => ({ commodity: e.commodity, note: `source: ${e.source}` }))
			)}
			{@render section(
				'invalid',
				'Invalid',
				invalid.length,
				'The price tag is malformed or the provider rejected it.',
				invalid.map((e) => ({ commodity: e.commodity, note: e.reason }))
			)}
			{@render section(
				'uncovered',
				'Not covered',
				uncovered.length,
				"Tagged for a provider that cannot serve them: a currency it does not publish, or a fund missing its APIR/ticker or not in the provider's catalogue selection.",
				uncovered.map((u) => ({ commodity: u.commodity, note: providerNames.get(u.providerId) }))
			)}
			{@render section(
				'ignored',
				'Ignored',
				ignored.length,
				'',
				ignored.map((e) => ({ commodity: e.commodity, action: 'unignore' as const }))
			)}

		{/if}
	</div>
</main>

<!-- Output file preview -->
<input type="checkbox" class="modal-toggle" aria-hidden="true" bind:checked={previewOpen} />
<dialog class="modal" aria-label="Output file preview">
	<div class="modal-box max-w-2xl">
		<h2 class="text-lg font-bold">Output file</h2>
		<p class="py-1 text-xs opacity-60">
			Current contents of <code>{config.targetFile}</code>{written === '' ? ' (empty)' : ''}.
		</p>
		<textarea
			class="textarea textarea-bordered h-72 w-full font-mono text-xs"
			readonly
			aria-label="Prices written to the output file"
			value={written ?? ''}></textarea>
		<footer class="mt-4 flex justify-end gap-2">
			<button
				type="button"
				class="btn btn-ghost"
				onclick={() => goto(`/opfs/edit-file?file=${encodeURIComponent(config.targetFile)}`)}
				>Open in editor</button
			>
			<button type="button" class="btn btn-primary" onclick={() => (previewOpen = false)}
				>Close</button
			>
		</footer>
	</div>
	<form method="dialog" class="modal-backdrop"><button onclick={() => (previewOpen = false)}>close</button></form>
</dialog>
