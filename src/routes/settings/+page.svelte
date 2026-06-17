<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { get } from 'svelte/store';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import { SHORT_DATE_FORMAT_DEFAULT } from '$lib/constants';
	import Notifier from '$lib/utils/notifier';
	import appService from '$lib/services/appService';
	import { goto, replaceState } from '$app/navigation';
	import { DefaultCurrencyStore, PendingSettingsStore, ShortDateFormatStore } from '$lib/data/mainStore.js';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { BoxIcon, Check, CreditCardIcon, FileBraces, NetworkIcon, RotateCcw, TrendingUpIcon } from '@lucide/svelte';
	import Fab from '$lib/components/FAB.svelte';
	import { page } from '$app/state';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { AA_DEFINITION_FILE, USER_BOOK_FILENAME } from '$lib/constants';
	import { saveFile, fileExists } from '$lib/utils/opfslib';

	Notifier.init();

	const DATE_FORMAT_DEFAULT = 'D MMM YYYY';
	const dateFormatOptions = [
		{ label: '29 Aug 2026', value: 'D MMM YYYY' },
		{ label: 'Aug 29, 2026', value: 'MMM D, YYYY' },
		{ label: '2026-08-29 (ISO)', value: 'YYYY-MM-DD' },
		{ label: '29/08/2026', value: 'DD/MM/YYYY' },
		{ label: '08/29/2026', value: 'MM/DD/YYYY' }
	];

	const shortDateFormatOptions = [
		{ label: 'Aug 05', value: 'MMM DD' },
		{ label: '5.8.', value: 'D.M.' },
		{ label: '5/8', value: 'D/M' },
		{ label: '8/5 (US)', value: 'M/D' },
		{ label: '05.08.', value: 'DD.MM.' },
		{ label: '05/08', value: 'DD/MM' },
		{ label: '08/05 (US)', value: 'MM/DD' }
	];

	let ledgerCacheEnabled = $state<boolean>(true);
	let currency = $state<string>();
	let bookCurrencies = $state<string[]>([]);
	let bookFilename = $state<string | null>(null);
	let assetAllocationDefinition = $state<string | null>(null);
	let rootInvestmentAccount = $state<string>();
	let dateFormat = $state<string>(DATE_FORMAT_DEFAULT);
	let shortDateFormat = $state<string>(SHORT_DATE_FORMAT_DEFAULT);
	let loaded = $state(false);

	// Saved (DB) values for revert comparison
	let savedCurrency = $state<string | undefined>(undefined);
	let savedBookFilename = $state<string | null>(null);
	let savedAssetAllocationDefinition = $state<string | null>(null);
	let savedRootInvestmentAccount = $state<string | undefined>(undefined);
	let savedDateFormat = $state<string>(DATE_FORMAT_DEFAULT);
	let savedShortDateFormat = $state<string>(SHORT_DATE_FORMAT_DEFAULT);

	// Dirty flags — only meaningful after initial load
	let currencyDirty = $derived(loaded && currency !== savedCurrency);
	let bookFilenameDirty = $derived(loaded && bookFilename !== savedBookFilename);
	let assetAllocationDirty = $derived(
		loaded && assetAllocationDefinition !== savedAssetAllocationDefinition
	);
	let rootInvestmentDirty = $derived(
		loaded && rootInvestmentAccount !== savedRootInvestmentAccount
	);
	let dateFormatDirty = $derived(loaded && dateFormat !== savedDateFormat);
	let shortDateFormatDirty = $derived(loaded && shortDateFormat !== savedShortDateFormat);

	// Save form state before navigating away (e.g. to file picker)
	beforeNavigate(() => {
		if (loaded) {
			PendingSettingsStore.set({
				currency,
				bookFilename,
				assetAllocationDefinition,
				rootInvestmentAccount,
				dateFormat,
				shortDateFormat
			});
		}
	});

	onMount(async () => {
		// Handle return from file picker (sets bookFilename / assetAllocationDefinition from URL)
		await handleFilePickerReturn();

		// load data
		await loadData();

		loaded = true;
	});

	async function handleFilePickerReturn() {
		const settingKey = page.url.searchParams.get('settingKey');
		const settingValue = page.url.searchParams.get('settingValue');

		if (!settingKey || !settingValue) {
			return;
		}

		switch (settingKey) {
			case USER_BOOK_FILENAME:
				bookFilename = settingValue;
				break;
			case SettingKeys.assetAllocationDefinition:
				assetAllocationDefinition = settingValue;
				break;
			default:
				console.warn(`Unknown setting key returned from file picker: ${settingKey}`);
				return;
		}

		// Remove params from URL without triggering navigation
		replaceState('', {});
	}

	async function loadData() {
		// Restore pending state saved before navigating to file picker
		const pending = get(PendingSettingsStore);

		bookCurrencies = await fullLedgerService.getOperatingCurrencies();

		// Load saved DB values (used for revert comparison and as fallback)
		savedCurrency = (await appService.getDefaultCurrency()) ?? undefined;
		savedBookFilename = (await appService.readBookFilename()) ?? null;
		savedRootInvestmentAccount = (await settings.get<string>(SettingKeys.rootInvestmentAccount)) as
			| string
			| undefined;
		ledgerCacheEnabled = (await settings.get<boolean>(SettingKeys.ledgerCacheEnabled)) ?? true;
		savedAssetAllocationDefinition =
			(await settings.get<string>(SettingKeys.assetAllocationDefinition)) ?? null;
		savedDateFormat =
			(await settings.get<string>(SettingKeys.dateFormat)) ?? DATE_FORMAT_DEFAULT;
		savedShortDateFormat =
			(await settings.get<string>(SettingKeys.shortDateFormat)) ?? SHORT_DATE_FORMAT_DEFAULT;

		// Auto-detect currency from book if not saved yet
		if (!savedCurrency && bookCurrencies.length > 0) {
			savedCurrency = bookCurrencies[0];
			await settings.set(SettingKeys.currency, savedCurrency);
		}

		// Populate form: pending values take precedence over saved values.
		// URL-param values (set by handleFilePickerReturn above) take precedence over pending.
		currency = pending?.currency ?? savedCurrency;
		if (!bookFilename) bookFilename = pending?.bookFilename ?? savedBookFilename;
		if (!assetAllocationDefinition)
			assetAllocationDefinition =
				pending?.assetAllocationDefinition ?? savedAssetAllocationDefinition;
		rootInvestmentAccount = pending?.rootInvestmentAccount ?? savedRootInvestmentAccount;
		dateFormat = pending?.dateFormat ?? savedDateFormat;
		shortDateFormat = pending?.shortDateFormat ?? savedShortDateFormat;
	}

	async function onOpfsClick() {
		await goto('/opfs');
	}

	async function onCreateOrEditAA() {
		if (!assetAllocationDefinition) {
			if (!(await fileExists(AA_DEFINITION_FILE))) {
				await saveFile(AA_DEFINITION_FILE, '');
			}
			assetAllocationDefinition = AA_DEFINITION_FILE;
		}
		await goto('/asset-allocation/editor');
	}

	async function saveSettings() {
		await settings.set(SettingKeys.currency, currency);
		DefaultCurrencyStore.set(currency as string);

		await settings.set(SettingKeys.rootInvestmentAccount, rootInvestmentAccount);
		await settings.set(SettingKeys.ledgerCacheEnabled, ledgerCacheEnabled);
		await settings.set(SettingKeys.assetAllocationDefinition, assetAllocationDefinition);
		await settings.set(SettingKeys.dateFormat, dateFormat);
		await settings.set(SettingKeys.shortDateFormat, shortDateFormat);
		ShortDateFormatStore.set(shortDateFormat);

		// Save book filename in cashier.bean
		if (bookFilename) {
			await appService.writeBookFilename(bookFilename);
		}

		// invalidateStorageBackendCache();

		// Clear pending store now that everything is saved
		PendingSettingsStore.set(undefined);

		Notifier.success('Settings saved');

		await goto('/'); // Go to home after saving settings
	}
</script>

<Toolbar title="Settings">
	{#snippet menuItems()}
		<ToolbarMenuItem text="OPFS Storage" Icon={BoxIcon} onclick={onOpfsClick} />
		<ToolbarMenuItem text="JSON Editor" Icon={FileBraces} targetNav="/settings/json-editor" />
		<ToolbarMenuItem text="WebDAV Config" Icon={NetworkIcon} targetNav="/settings/webdav-cfg" />
	{/snippet}
</Toolbar>

<main class="mx-auto max-w-2xl space-y-3 p-3 pb-20">

	<!-- ── General ─────────────────────────────────────────── -->
	<div class="divider text-sm font-semibold uppercase tracking-widest">General</div>

	<!-- Currency -->
	<div class="flex items-center gap-3">
		<label for="currency" class="flex-1 text-sm font-medium">Main Currency</label>
		<div class="flex shrink-0 items-center gap-1">
			<input
				id="currency"
				class="input input-sm w-28 rounded"
				type="text"
				placeholder="EUR, USD…"
				bind:value={currency}
			/>
			{#if currencyDirty}
				<button
					type="button"
					class="btn btn-ghost btn-xs btn-square"
					title="Revert"
					onclick={() => (currency = savedCurrency)}
				>
					<RotateCcw size={14} />
				</button>
			{/if}
		</div>
	</div>
	{#if bookCurrencies.length > 0}
		<p class="text-right text-xs opacity-60">Book: {bookCurrencies.join(', ')}</p>
	{/if}

	<!-- Long Date Format -->
	<div class="flex items-center gap-3">
		<label for="date-format" class="flex-1 text-sm font-medium">Long Date Format</label>
		<div class="flex shrink-0 items-center gap-1">
			<select id="date-format" class="select select-sm w-40 rounded" bind:value={dateFormat}>
				{#each dateFormatOptions as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
			{#if dateFormatDirty}
				<button
					type="button"
					class="btn btn-ghost btn-xs btn-square"
					title="Revert"
					onclick={() => (dateFormat = savedDateFormat)}
				>
					<RotateCcw size={14} />
				</button>
			{/if}
		</div>
	</div>

	<!-- Short Date Format -->
	<div class="flex items-center gap-3">
		<label for="short-date-format" class="flex-1 text-sm font-medium">Short Date Format</label>
		<div class="flex shrink-0 items-center gap-1">
			<select id="short-date-format" class="select select-sm w-40 rounded" bind:value={shortDateFormat}>
				{#each shortDateFormatOptions as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
			{#if shortDateFormatDirty}
				<button
					type="button"
					class="btn btn-ghost btn-xs btn-square"
					title="Revert"
					onclick={() => (shortDateFormat = savedShortDateFormat)}
				>
					<RotateCcw size={14} />
				</button>
			{/if}
		</div>
	</div>

	<!-- ── Ledger Configuration ────────────────────────────── -->
	<div class="divider text-sm font-semibold uppercase tracking-widest">Ledger Configuration</div>

	<p class="text-xs opacity-60">
		<a href="/opfs/import-ledger" class="link">Import Ledger files</a> first, then choose the book
		file below.
	</p>

	<!-- Book file -->
	<div class="flex items-center gap-3">
		<div class="min-w-0 flex-1">
			<p class="text-sm font-medium">Book file</p>
			<p class="truncate font-mono text-xs opacity-60">{bookFilename ?? 'Not set'}</p>
		</div>
		<div class="flex shrink-0 items-center gap-1">
			{#if bookFilenameDirty}
				<button
					type="button"
					class="btn btn-ghost btn-xs btn-square"
					title="Revert"
					onclick={() => (bookFilename = savedBookFilename)}
				>
					<RotateCcw size={14} />
				</button>
			{/if}
			<button
				class="btn btn-primary btn-xs rounded"
				type="button"
				onclick={() => goto(`/opfs/file-picker?returnSetting=${USER_BOOK_FILENAME}`)}
			>
				Select
			</button>
		</div>
	</div>

	<!-- Ledger cache -->
	<div class="flex items-center gap-3">
		<label for="ledger-cache-enabled" class="flex-1 text-sm font-medium">
			Enable ledger cache
		</label>
		<input
			id="ledger-cache-enabled"
			class="checkbox checkbox-primary checkbox-sm shrink-0 rounded"
			type="checkbox"
			bind:checked={ledgerCacheEnabled}
		/>
	</div>

	<!-- ── Asset Allocation ────────────────────────────────── -->
	<div class="divider text-sm font-semibold uppercase tracking-widest">Asset Allocation</div>

	<!-- AA definition file -->
	<div class="flex items-center gap-3">
		<div class="min-w-0 flex-1">
			<p class="text-sm font-medium">Definition file</p>
			<p class="truncate font-mono text-xs opacity-60">
				{assetAllocationDefinition ?? 'Not set'}
			</p>
		</div>
		<div class="flex shrink-0 items-center gap-1">
			{#if assetAllocationDirty}
				<button
					type="button"
					class="btn btn-ghost btn-xs btn-square"
					title="Revert"
					onclick={() => (assetAllocationDefinition = savedAssetAllocationDefinition)}
				>
					<RotateCcw size={14} />
				</button>
			{/if}
			<button
				class="btn btn-secondary btn-xs rounded"
				type="button"
				onclick={onCreateOrEditAA}
			>
				{assetAllocationDefinition ? 'Edit' : 'Create'}
			</button>
			<button
				class="btn btn-primary btn-xs rounded"
				type="button"
				onclick={() =>
					goto(`/opfs/file-picker?returnSetting=${SettingKeys.assetAllocationDefinition}`)}
			>
				Select
			</button>
		</div>
	</div>

	<!-- Investment account root -->
	<div class="flex items-center gap-3">
		<label for="investment-account-root" class="flex-1 text-sm font-medium">
			Investment account root
		</label>
		<div class="flex shrink-0 items-center gap-1">
			<input
				id="investment-account-root"
				class="input input-sm w-44 rounded"
				type="text"
				placeholder="Assets:Investments"
				bind:value={rootInvestmentAccount}
			/>
			{#if rootInvestmentDirty}
				<button
					type="button"
					class="btn btn-ghost btn-xs btn-square"
					title="Revert"
					onclick={() => (rootInvestmentAccount = savedRootInvestmentAccount)}
				>
					<RotateCcw size={14} />
				</button>
			{/if}
		</div>
	</div>

	<!-- ── Forecast ────────────────────────────────────────── -->
	<div class="divider text-sm font-semibold uppercase tracking-widest">Forecast</div>

	<div class="flex flex-col gap-2">
		<a href="/forecast-settings" class="btn btn-outline btn-sm w-full gap-2">
			<TrendingUpIcon size={16} />
			Forecast Settings
		</a>
		<a href="/credit-card-settings" class="btn btn-outline btn-sm w-full gap-2">
			<CreditCardIcon size={16} />
			Credit Card Settings
		</a>
	</div>

	<Fab Icon={Check} onclick={saveSettings} />
</main>
