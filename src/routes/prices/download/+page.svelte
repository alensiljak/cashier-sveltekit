<script lang="ts">
	import Toolbar from '#lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '#lib/components/ToolbarMenuItem.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import SearchableSelect from '#lib/components/SearchableSelect.svelte';
	import {
		resolveConfig,
		saveConfig,
		getSymbolSelection,
		planDownload,
		downloadPrices,
		validateTargetFile,
		isTargetIncluded,
		describeError,
		getDownloadStatus,
		type PriceDownloadConfig,
		type PriceDownloadPlan,
		type PriceDownloadResult,
		type PriceDownloadStatus
	} from '#lib/services/prices/priceDownloadService';
	import {
		listPriceProviders,
		defaultPriceProvider
	} from '#lib/services/prices/priceProviderRegistry';
	import demoDataService from '#lib/services/demoDataService';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { PRICES_DEFAULT_DESTINATION } from '#lib/constants';
	import { deviceSettings, DeviceSettingKeys, SettingKeys } from '#lib/settings';
	import { onMount } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';

	const providers = listPriceProviders();
	const defaultProvider = defaultPriceProvider();

	let config = $state<PriceDownloadConfig>({
		providerId: defaultProvider.id,
		targetFile: PRICES_DEFAULT_DESTINATION,
		writeMode: 'overwrite',
		symbols: null
	});
	let loaded = $state(false);
	let targetError = $state<string | null>(null);
	/** Whether the main book includes the destination; null = unknown. */
	let included = $state<boolean | null>(null);
	let plan = $state<PriceDownloadPlan | null>(null);
	let status = $state<PriceDownloadStatus | null>(null);
	let result = $state<PriceDownloadResult | null>(null);
	let running = $state(false);
	let error = $state<string | null>(null);
	let demoActive = $state(false);
	let proxyKey = $state('');
	let proxyKeyDraft = $state('');
	let proxyKeyModalOpen = $state(false);

	const provider = $derived(plan?.provider ?? providers.find((p) => p.id === config.providerId));

	/** Every selectable candidate, in display order. */
	const symbolOptions = $derived(
		plan
			? [
					...plan.availableSymbols.map((symbol) => ({ symbol, inverted: false })),
					...plan.availableInvertedSymbols.map((symbol) => ({ symbol, inverted: true }))
				]
			: []
	);

	/** `null` in the config means every candidate is selected. */
	const selectedSymbols = $derived.by(() => {
		const stored = config.symbols === null ? null : new Set(config.symbols);
		return new Set(
			symbolOptions
				.filter((option) => stored === null || stored.has(option.symbol))
				.map((option) => option.symbol)
		);
	});

	// The ledger reloads in the background after a download (and after any
	// file change); refresh the preview whenever it finishes.
	const ledgerVersion = fullLedgerService.version;
	$effect(() => {
		void $ledgerVersion;
		if (loaded) void refreshPlan();
	});

	onMount(load);

	async function load() {
		config = await resolveConfig();
		applyPickerReturn();
		await checkTarget();
		await refreshPlan();
		status = await getDownloadStatus();
		demoActive = await demoDataService.isDemoActive();
		proxyKey = (await deviceSettings.get<string>(DeviceSettingKeys.proxyKey)) ?? '';
		loaded = true;
	}

	function openProxyKeyModal() {
		proxyKeyDraft = proxyKey;
		proxyKeyModalOpen = true;
	}

	async function saveProxyKey() {
		proxyKey = proxyKeyDraft.trim();
		await deviceSettings.set(DeviceSettingKeys.proxyKey, proxyKey);
		proxyKeyModalOpen = false;
	}

	/** The OPFS file picker hands the chosen path back via the URL. */
	function applyPickerReturn() {
		const key = page.url.searchParams.get('settingKey');
		const value = page.url.searchParams.get('settingValue');
		if (key !== SettingKeys.priceTargetFile || !value) return;
		config = { ...config, targetFile: value };
		void saveConfig(config);
		replaceState(page.url.pathname, {});
	}

	async function checkTarget() {
		targetError = await validateTargetFile(config.targetFile);
		included = targetError ? null : await isTargetIncluded(config.targetFile);
	}

	async function refreshPlan() {
		try {
			plan = await planDownload(config);
			error = null;
		} catch (e) {
			plan = null;
			error = describeError(e);
		}
	}

	/** Persist on change and keep the preview in sync. */
	async function updateConfig(patch: Partial<PriceDownloadConfig>) {
		config = { ...config, ...patch };
		await checkTarget();
		await saveConfig(config);
		await refreshPlan();
	}

	/** Each provider keeps its own selection; switching loads that one. */
	async function changeProvider(providerId: string) {
		const symbols = await getSymbolSelection(providerId);
		config = { ...config, providerId, symbols };
		await checkTarget();
		await saveConfig(config);
		await refreshPlan();
	}

	async function setSymbols(symbols: string[] | null) {
		config = { ...config, symbols };
		await saveConfig(config);
		await refreshPlan();
	}

	function toggleSymbol(symbol: string, checked: boolean) {
		const selected = new Set(selectedSymbols);
		if (checked) selected.add(symbol);
		else selected.delete(symbol);
		const next = symbolOptions.map((option) => option.symbol).filter((s) => selected.has(s));
		// Selecting every candidate stores `null`, so a currency the book starts
		// using later is downloaded without revisiting this page.
		void setSymbols(next.length === symbolOptions.length ? null : next);
	}

	function pickTargetFile() {
		void goto(
			`/opfs/file-picker?returnSetting=${SettingKeys.priceTargetFile}&returnTo=${encodeURIComponent('/prices/download')}&allowNew=1&ext=.bean`
		);
	}

	async function runDownload() {
		running = true;
		error = null;
		result = null;
		try {
			result = await downloadPrices(config);
			status = await getDownloadStatus();
			// The file write triggered a background ledger reload; the plan's
			// book pairs may have grown, so recompute the preview.
			await refreshPlan();
		} catch (e) {
			error = describeError(e);
			status = await getDownloadStatus();
		} finally {
			running = false;
		}
	}
</script>

<Toolbar title="Price Download">
	{#snippet actions()}
		<HelpButton topic="price-download" />
	{/snippet}
	{#snippet menuItems()}
		<ToolbarMenuItem text="Proxy key" Icon={KeyRoundIcon} onclick={openProxyKeyModal} />
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

		<!-- ── Configuration ─────────────────────────────────────── -->
		<div class="card bg-base-100 rounded-lg">
			<div class="bg-primary rounded-t-lg px-3 py-2 text-lg">Configuration</div>
			<div class="card-body py-3 px-3 space-y-4">
				<label class="form-control w-full">
					<div class="label"><span class="label-text">Provider</span></div>
					<SearchableSelect
						options={providers.map((p) => p.name)}
						value={provider?.name ?? ''}
						onchange={(name) => {
							const found = providers.find((p) => p.name === name);
							if (found) void changeProvider(found.id);
						}}
					/>
				</label>

				<div>
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
						<p class="mt-1 text-xs text-error">{targetError}</p>
					{/if}
					{#if included === false && !demoActive}
						<p class="mt-1 text-xs text-warning">
							Your main book has no <code>include "{config.targetFile}"</code> line, so these prices will
							have no effect until you add one (nested includes are followed, but glob patterns are not
							expanded).
						</p>
					{:else}
						<p class="mt-1 text-xs opacity-60">
							The app does not edit your book — wire the file in yourself with<code class="mx-1"
								>include "{config.targetFile}"</code
							>.
						</p>
					{/if}
				</div>

				<div class="flex items-center justify-between gap-3">
					<div class="flex-1">
						<p class="text-sm font-medium">Append history</p>
						<p class="text-xs opacity-60">
							{config.writeMode === 'append'
								? 'New fixing dates are added; earlier downloaded rates are kept.'
								: 'Off — the file is rewritten with the latest rates only. Anything else in the file is lost.'}
						</p>
					</div>
					<input
						type="checkbox"
						class="toggle toggle-success bg-transparent bg-none"
						checked={config.writeMode === 'append'}
						onchange={(e) =>
							void updateConfig({ writeMode: e.currentTarget.checked ? 'append' : 'overwrite' })}
					/>
				</div>
			</div>
		</div>

		<!-- ── Preview ────────────────────────────────────────────── -->
		{#if plan}
			<div class="card bg-base-100 rounded-lg">
				<div class="bg-primary rounded-t-lg px-3 py-2 text-lg">Symbols to download</div>
				<div class="card-body py-3 px-3 space-y-3">
					{#if plan.provider.kind === 'securities'}
						<p class="text-xs opacity-60">Prices are quoted in each fund's own currency.</p>
					{:else if plan.provider.base !== 'EUR'}
						<p class="text-xs opacity-60">Pairs are published as {plan.provider.base}-base.</p>
					{/if}

					{#if symbolOptions.length > 0}
						<div class="flex items-center justify-between gap-2">
							<p class="text-xs opacity-60">
								{selectedSymbols.size} of {symbolOptions.length} selected
							</p>
							<div class="flex gap-1">
								<button
									type="button"
									class="btn btn-ghost btn-xs rounded"
									onclick={() => void setSymbols(null)}>All</button
								>
								<button
									type="button"
									class="btn btn-ghost btn-xs rounded"
									onclick={() => void setSymbols([])}>None</button
								>
							</div>
						</div>

						<div class="flex flex-wrap gap-1">
							{#each plan.availableSymbols as symbol (symbol)}
								<label class="badge badge-outline h-auto cursor-pointer gap-1.5 py-1.5">
									<input
										type="checkbox"
										class="checkbox checkbox-xs"
										checked={selectedSymbols.has(symbol)}
										onchange={(e) => toggleSymbol(symbol, e.currentTarget.checked)}
									/>
									<span>
										{#if plan.provider.kind === 'securities'}
											{symbol}
										{:else}
											{plan.provider.base} → {symbol}
										{/if}
									</span>
								</label>
							{/each}

							{#each plan.availableInvertedSymbols as symbol (symbol)}
								<label
									class="badge badge-ghost h-auto cursor-pointer gap-1.5 py-1.5"
									title="Your book already keeps this pair — the prices extend that series, in its own direction."
								>
									<input
										type="checkbox"
										class="checkbox checkbox-xs"
										checked={selectedSymbols.has(symbol)}
										onchange={(e) => toggleSymbol(symbol, e.currentTarget.checked)}
									/>
									<span>{symbol} → {plan.provider.base} (your series)</span>
								</label>
							{/each}
						</div>
					{:else}
						<p class="text-sm opacity-70">
							Nothing to fetch — the provider cannot serve any of the commodities your book uses.
						</p>
					{/if}

					{#if symbolOptions.length > 0 && plan.symbols.length + plan.invertedSymbols.length === 0}
						<p class="text-sm opacity-70">No symbols selected — pick at least one above.</p>
					{/if}
				</div>
			</div>
		{/if}

		<!-- ── Download ───────────────────────────────────────────── -->
		<button
			type="button"
			class="btn btn-primary"
			disabled={running ||
				!!targetError ||
				!plan ||
				plan.symbols.length + plan.invertedSymbols.length === 0}
			onclick={() => void runDownload()}
		>
			{#if running}
				<span class="loading loading-spinner loading-sm"></span>
			{:else}
				<DownloadIcon size={16} />
			{/if}
			{running ? 'Downloading…' : 'Download latest prices'}
		</button>

		{#if error}
			<div class="alert alert-error text-sm"><span>{error}</span></div>
		{/if}

		{#if result}
			<div class="card bg-base-200 rounded-lg">
				<div class="card-body py-3 px-3">
					<p class="text-sm">
						{#if result.fixingDate && result.unchanged}
							The {result.fixingDate} prices are already in <code>{result.targetFile}</code> — no changes.
						{:else if result.fixingDate}
							Downloaded the {result.fixingDate} prices into
							<code>{result.targetFile}</code>
							— {result.added}
							{result.added === 1 ? 'line' : 'lines'} added{result.writeMode === 'append'
								? `, ${result.updated} updated${result.removed > 0 ? `, ${result.removed} opposite-direction removed` : ''}, ${result.directives} lines in file`
								: ''}.
						{:else}
							Nothing to fetch.
						{/if}
					</p>
					{#if result.missing.length > 0}
						<p class="text-sm text-warning">
							Not in the provider's response, so not written: {result.missing.join(', ')}
						</p>
					{/if}
				</div>
			</div>
		{/if}

		<!-- ── Status ─────────────────────────────────────────────── -->
		{#if status}
			<div class="card bg-base-100 rounded-lg">
				<div class="bg-primary rounded-t-lg px-3 py-2 text-lg">Last run</div>
				<div class="card-body py-3 px-3 text-sm space-y-1">
					{#if status.lastError}
						<p class="text-error">{status.lastError}</p>
					{/if}
					<p><span class="opacity-60">When:</span> {new Date(status.lastRun).toLocaleString()}</p>
					{#if status.fixingDate}
						<p><span class="opacity-60">Last price date:</span> {status.fixingDate}</p>
						<p>
							<span class="opacity-60">Destination:</span>
							{status.targetFile} ({status.writeMode})
						</p>
						<p>
							<span class="opacity-60">Lines in file:</span>
							{status.directives ?? '—'}
						</p>
						{#if (status.missing ?? []).length > 0}
							<p class="text-warning">
								<span class="opacity-60">Missing from response:</span>
								{(status.missing ?? []).join(', ')}
							</p>
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	</div>
</main>

<!-- Proxy key dialog -->
<input type="checkbox" id="proxy-key-modal" class="modal-toggle" bind:checked={proxyKeyModalOpen} />
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Proxy key</h2>
		</header>
		<article>
			<p class="py-2 text-sm opacity-60">
				Stored on this device only and sent as the <code>X-Proxy-Key</code> header. Leave empty when the
				proxy is not protected.
			</p>
			<input
				type="password"
				class="input input-bordered w-full"
				autocomplete="off"
				aria-label="Proxy key"
				placeholder="Required when the server sets PROXY_KEY"
				bind:value={proxyKeyDraft}
				onkeydown={(e) => e.key === 'Enter' && void saveProxyKey()}
			/>
		</article>
		<footer class="flex justify-end gap-4 mt-4">
			<button type="button" class="btn btn-ghost" onclick={() => (proxyKeyModalOpen = false)}
				>Cancel</button
			>
			<button type="button" class="btn btn-primary" onclick={() => void saveProxyKey()}>Save</button
			>
		</footer>
	</div>
</dialog>
