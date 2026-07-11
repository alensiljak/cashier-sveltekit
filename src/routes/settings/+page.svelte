<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { get } from 'svelte/store';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings, DeviceSettingKeys, deviceSettings } from '$lib/settings';
	import { SHORT_DATE_FORMAT_DEFAULT } from '$lib/constants';
	import Notifier from '$lib/utils/notifier';
	import appService from '$lib/services/appService';
	import { goto, replaceState } from '$app/navigation';
	import {
		DefaultCurrencyStore,
		PendingSettingsStore,
		ShortDateFormatStore
	} from '$lib/data/mainStore.js';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import SectionTitle from '$lib/components/SectionTitle.svelte';
	import {
		BoxIcon,
		Check,
		FileBraces,
		NetworkIcon,
		RotateCcw,
		TrendingUpIcon
	} from '@lucide/svelte';
	import Fab from '$lib/components/FAB.svelte';
	import { page } from '$app/state';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import {
		AA_DEFINITION_FILE,
		DEMO_AA_FILE,
		DEMO_BOOK_FILE,
		DEMO_DIR,
		DEMO_ROOT_INVESTMENT_ACCOUNT,
		USER_BOOK_FILENAME
	} from '$lib/constants';
	import { saveFile, fileExists } from '$lib/utils/opfslib';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import demoDataService from '$lib/services/demoDataService';

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
	let demoActive = $state(false);
	let showDemoLoadConfirm = $state(false);
	let showDemoRemoveConfirm = $state(false);
	let demoBusy = $state(false);

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
			string | undefined;
		ledgerCacheEnabled =
			(await deviceSettings.get<boolean>(DeviceSettingKeys.ledgerCacheEnabled)) ?? true;
		savedAssetAllocationDefinition =
			(await settings.get<string>(SettingKeys.assetAllocationDefinition)) ?? null;
		savedDateFormat = (await settings.get<string>(SettingKeys.dateFormat)) ?? DATE_FORMAT_DEFAULT;
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

		demoActive = await demoDataService.isDemoActive();
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

	function onLoadDemoClick() {
		if (savedBookFilename && savedBookFilename !== DEMO_BOOK_FILE) {
			showDemoLoadConfirm = true;
			return;
		}
		loadDemoData();
	}

	async function loadDemoData() {
		demoBusy = true;
		try {
			await demoDataService.activateDemoData();
			demoActive = true;
			savedBookFilename = DEMO_BOOK_FILE;
			bookFilename = DEMO_BOOK_FILE;
			savedAssetAllocationDefinition = DEMO_AA_FILE;
			assetAllocationDefinition = DEMO_AA_FILE;
			savedRootInvestmentAccount = DEMO_ROOT_INVESTMENT_ACCOUNT;
			rootInvestmentAccount = DEMO_ROOT_INVESTMENT_ACCOUNT;
			Notifier.success('Demo data loaded');
		} catch (err) {
			Notifier.error('Failed to load demo data: ' + err);
		} finally {
			demoBusy = false;
			showDemoLoadConfirm = false;
		}
	}

	function onRemoveDemoClick() {
		showDemoRemoveConfirm = true;
	}

	async function removeDemoData() {
		demoBusy = true;
		try {
			await demoDataService.removeDemoData();
			demoActive = false;
			if (savedBookFilename === DEMO_BOOK_FILE) {
				savedBookFilename = null;
				bookFilename = null;
			}
			if (savedAssetAllocationDefinition === DEMO_AA_FILE) {
				savedAssetAllocationDefinition = null;
				assetAllocationDefinition = null;
			}
			if (savedRootInvestmentAccount === DEMO_ROOT_INVESTMENT_ACCOUNT) {
				savedRootInvestmentAccount = undefined;
				rootInvestmentAccount = undefined;
			}
			Notifier.success('Demo data removed');
		} catch (err) {
			Notifier.error('Failed to remove demo data: ' + err);
		} finally {
			demoBusy = false;
			showDemoRemoveConfirm = false;
		}
	}

	async function saveSettings() {
		await settings.set(SettingKeys.currency, currency);
		DefaultCurrencyStore.set(currency as string);

		await settings.set(SettingKeys.rootInvestmentAccount, rootInvestmentAccount);
		await deviceSettings.set(DeviceSettingKeys.ledgerCacheEnabled, ledgerCacheEnabled);
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
	{#snippet actions()}
		<HelpButton topic="settings" />
	{/snippet}
	{#snippet menuItems()}
		<ToolbarMenuItem text="OPFS Storage" Icon={BoxIcon} onclick={onOpfsClick} />
		<ToolbarMenuItem text="JSON Editor" Icon={FileBraces} targetNav="/settings/json-editor" />
		<ToolbarMenuItem text="WebDAV Config" Icon={NetworkIcon} targetNav="/settings/webdav-cfg" />
	{/snippet}
</Toolbar>

<main class="mx-auto max-w-2xl space-y-3 p-3 pb-20">
	<!-- ── General ─────────────────────────────────────────── -->
	<div class="divider text-sm"><SectionTitle>General</SectionTitle></div>

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
			<select
				id="short-date-format"
				class="select select-sm w-40 rounded"
				bind:value={shortDateFormat}
			>
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
	<div class="divider text-sm"><SectionTitle>Ledger Configuration</SectionTitle></div>

	<p class="text-xs opacity-60">
		<a href="/opfs/import-ledger" class="link">Import Ledger files</a> first, then choose the book file
		below.
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

	<!-- ── Asset Allocation ────────────────────────────────── -->
	<div class="divider text-sm"><SectionTitle>Asset Allocation</SectionTitle></div>

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
			<button class="btn btn-secondary btn-xs rounded" type="button" onclick={onCreateOrEditAA}>
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
	<div class="divider text-sm"><SectionTitle>Forecast</SectionTitle></div>

	<div class="flex flex-col gap-2">
		<a href="/forecast-settings" class="btn btn-outline btn-sm w-full gap-2">
			<TrendingUpIcon size={16} />
			Forecast Settings
		</a>
	</div>

	<!-- ── Device Settings ────────────────────────────────── -->
	<div class="divider text-sm"><SectionTitle>Device Settings</SectionTitle></div>

	<p class="text-xs opacity-60">These settings apply only to this device and are not exported.</p>

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

	<!-- ── Demo Data ───────────────────────────────────────── -->
	<div class="divider text-sm"><SectionTitle>Demo Data</SectionTitle></div>

	<p class="text-xs opacity-60">
		A sample book (transactions, accounts, asset allocation target) to explore Cashier without your
		own data. Demo files live under <code>{DEMO_DIR}/</code> and are read-only — your own entries
		always go to <code>cashier.bean</code>.
	</p>

	<div class="flex items-center gap-3">
		<div class="min-w-0 flex-1">
			<p class="text-sm font-medium">Demo data</p>
			<p class="text-xs opacity-60">{demoActive ? 'Active' : 'Not loaded'}</p>
		</div>
		<div class="flex shrink-0 items-center gap-1">
			{#if demoActive}
				<button
					class="btn btn-error btn-xs rounded"
					type="button"
					onclick={onRemoveDemoClick}
					disabled={demoBusy}
				>
					Remove
				</button>
			{:else}
				<button
					class="btn btn-primary btn-xs rounded"
					type="button"
					onclick={onLoadDemoClick}
					disabled={demoBusy}
				>
					Load demo data
				</button>
			{/if}
		</div>
	</div>

	<Fab Icon={Check} onclick={saveSettings} />

	<!-- Load Demo Data Confirmation Modal -->
	{#if showDemoLoadConfirm}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="font-bold text-lg">Replace book with demo data?</h3>
				<p>
					This links your book file to the bundled demo book (<code>{DEMO_BOOK_FILE}</code>),
					instead of <code>{savedBookFilename}</code>. Your existing files are not deleted and can
					be re-selected afterwards.
				</p>
				<div class="modal-action">
					<button class="btn" onclick={() => (showDemoLoadConfirm = false)} disabled={demoBusy}>
						Cancel
					</button>
					<button class="btn btn-primary" onclick={loadDemoData} disabled={demoBusy}>
						{demoBusy ? 'Loading...' : 'Load Demo Data'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Remove Demo Data Confirmation Modal -->
	{#if showDemoRemoveConfirm}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="font-bold text-lg">Remove demo data?</h3>
				<p>Deletes <code>{DEMO_DIR}/</code> and unlinks it from your book settings.</p>
				<div class="modal-action">
					<button class="btn" onclick={() => (showDemoRemoveConfirm = false)} disabled={demoBusy}>
						Cancel
					</button>
					<button class="btn btn-error" onclick={removeDemoData} disabled={demoBusy}>
						{demoBusy ? 'Removing...' : 'Remove'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</main>
