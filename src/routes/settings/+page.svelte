<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { get } from 'svelte/store';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import appService from '$lib/services/appService';
	import { goto, replaceState } from '$app/navigation';
	import { DefaultCurrencyStore, PendingSettingsStore } from '$lib/data/mainStore.js';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { BoxIcon, Check, FileBraces, NetworkIcon, RotateCcw } from '@lucide/svelte';
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

	let rememberLastTransaction = $state<boolean>();
	let ledgerCacheEnabled = $state<boolean>(true);
	let currency = $state<string>();
	let bookCurrencies = $state<string[]>([]);
	let bookFilename = $state<string | null>(null);
	let assetAllocationDefinition = $state<string | null>(null);
	let rootInvestmentAccount = $state<string>();
	let dateFormat = $state<string>(DATE_FORMAT_DEFAULT);
	let loaded = $state(false);

	// Saved (DB) values for revert comparison
	let savedCurrency = $state<string | undefined>(undefined);
	let savedBookFilename = $state<string | null>(null);
	let savedAssetAllocationDefinition = $state<string | null>(null);
	let savedRootInvestmentAccount = $state<string | undefined>(undefined);
	let savedRememberLastTransaction = $state<boolean | undefined>(undefined);
	let savedDateFormat = $state<string>(DATE_FORMAT_DEFAULT);

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

	// Save form state before navigating away (e.g. to file picker)
	beforeNavigate(() => {
		if (loaded) {
			PendingSettingsStore.set({
				currency,
				rememberLastTransaction,
				bookFilename,
				assetAllocationDefinition,
				rootInvestmentAccount,
				dateFormat
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
		savedRememberLastTransaction = (await settings.get<boolean>(
			SettingKeys.rememberLastTransaction
		)) as boolean | undefined;
		ledgerCacheEnabled = (await settings.get<boolean>(SettingKeys.ledgerCacheEnabled)) ?? true;
		savedAssetAllocationDefinition =
			(await settings.get<string>(SettingKeys.assetAllocationDefinition)) ?? null;
		savedDateFormat =
			(await settings.get<string>(SettingKeys.dateFormat)) ?? DATE_FORMAT_DEFAULT;

		// Auto-detect currency from book if not saved yet
		if (!savedCurrency && bookCurrencies.length > 0) {
			savedCurrency = bookCurrencies[0];
			await settings.set(SettingKeys.currency, savedCurrency);
		}

		// Populate form: pending values take precedence over saved values.
		// URL-param values (set by handleFilePickerReturn above) take precedence over pending.
		currency = pending?.currency ?? savedCurrency;
		rememberLastTransaction = pending?.rememberLastTransaction ?? savedRememberLastTransaction;
		if (!bookFilename) bookFilename = pending?.bookFilename ?? savedBookFilename;
		if (!assetAllocationDefinition)
			assetAllocationDefinition =
				pending?.assetAllocationDefinition ?? savedAssetAllocationDefinition;
		rootInvestmentAccount = pending?.rootInvestmentAccount ?? savedRootInvestmentAccount;
		dateFormat = pending?.dateFormat ?? savedDateFormat;
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
		await settings.set(SettingKeys.rememberLastTransaction, rememberLastTransaction);
		await settings.set(SettingKeys.ledgerCacheEnabled, ledgerCacheEnabled);
		await settings.set(SettingKeys.assetAllocationDefinition, assetAllocationDefinition);
		await settings.set(SettingKeys.dateFormat, dateFormat);

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

<main class="mx-auto max-w-6xl space-y-4 p-1">
	<!-- currency -->
	<div class="form-control w-full">
		<div class="flex items-baseline gap-4">
			<label for="currency" class="label">
				<span class="label-text">Main Currency</span>
			</label>
		</div>
		<div class="flex gap-2">
			<input
				id="currency"
				class="input rounded flex-1"
				type="text"
				placeholder="EUR, USD, etc."
				bind:value={currency}
			/>
			{#if currencyDirty}
				<button
					type="button"
					class="btn btn-outline btn-error btn-sm btn-square rounded"
					title="Revert change"
					onclick={() => (currency = savedCurrency)}
				>
					<RotateCcw size={16} />
				</button>
			{/if}
		</div>
		{#if bookCurrencies.length > 0}
			<span class="text-sm opacity-70">Book currencies: {bookCurrencies.join(', ')}</span>
		{/if}
	</div>

	<!-- last transaction -->
	<label for="remember-last-transaction" class="flex items-center space-x-2">
		<input
			id="remember-last-transaction"
			class="checkbox checkbox-primary rounded"
			type="checkbox"
			bind:checked={rememberLastTransaction}
		/>
		<p>Remember last transaction for payees.</p>
	</label>

	<h3 class="text-xl font-bold">Ledger Configuration</h3>

	<p class="text-sm">
		<a href="/opfs/import-ledger" class="link">Import Ledger files</a>
		first, then choose the book file here.
	</p>

	<div class="flex items-center gap-4">
		<div class="flex-1">
			<p class="text-sm font-medium">Book file:</p>
			<p class="font-mono text-sm opacity-70">{bookFilename ?? 'Not set'}</p>
		</div>
		{#if bookFilenameDirty}
			<button
				type="button"
				class="btn btn-outline btn-error btn-sm btn-square rounded"
				title="Revert change"
				onclick={() => (bookFilename = savedBookFilename)}
			>
				<RotateCcw size={16} />
			</button>
		{/if}
		<button
			class="btn btn-primary btn-sm rounded"
			type="button"
			onclick={() => goto(`/opfs/file-picker?returnSetting=${USER_BOOK_FILENAME}`)}
		>
			Select
		</button>
	</div>

	<h3 class="text-xl font-bold">Asset Allocation</h3>

	<div class="flex items-center gap-4">
		<div class="flex-1">
			<p class="text-sm font-medium">Asset allocation definition</p>
			<p class="font-mono text-sm opacity-70">{assetAllocationDefinition ?? 'Not set'}</p>
		</div>
		{#if assetAllocationDirty}
			<button
				type="button"
				class="btn btn-outline btn-error btn-sm btn-square rounded"
				title="Revert change"
				onclick={() => (assetAllocationDefinition = savedAssetAllocationDefinition)}
			>
				<RotateCcw size={16} />
			</button>
		{/if}
		<button class="btn btn-secondary btn-sm rounded" type="button" onclick={onCreateOrEditAA}>
			{assetAllocationDefinition ? 'Edit' : 'Create'}
		</button>
		<button
			class="btn btn-primary btn-sm rounded"
			type="button"
			onclick={() =>
				goto(`/opfs/file-picker?returnSetting=${SettingKeys.assetAllocationDefinition}`)}
		>
			Select
		</button>
	</div>

	<!-- investment account -->
	<div class="form-control w-full">
		<div>
			<label for="investment-account-root" class="label">
				<span class="label-text">Investment account root:</span>
			</label>
		</div>
		<div class="flex gap-2">
			<input
				id="investment-account-root"
				class="input rounded flex-1"
				type="text"
				placeholder="i.e. Assets:Investments"
				bind:value={rootInvestmentAccount}
			/>
			{#if rootInvestmentDirty}
				<button
					type="button"
					class="btn btn-outline btn-error btn-sm btn-square rounded"
					title="Revert change"
					onclick={() => (rootInvestmentAccount = savedRootInvestmentAccount)}
				>
					<RotateCcw size={16} />
				</button>
			{/if}
		</div>
	</div>

	<!-- Ledger cache -->
	<section>
		<h3 class="text-xl font-bold">Ledger Caching</h3>

		<div class="my-3">
		<label for="ledger-cache-enabled" class="flex items-center space-x-2">
			<input
				id="ledger-cache-enabled"
				class="checkbox checkbox-primary rounded"
				type="checkbox"
				bind:checked={ledgerCacheEnabled}
			/>
			<p>Enable ledger cache (load from binary cache on startup).</p>
		</label>
		</div>
	</section>

	<h3 class="text-xl font-bold">Formatting</h3>

	<div class="form-control w-full">
		<label for="date-format" class="label">
			<span class="label-text">Date Format</span>
		</label>
		<div class="flex gap-2">
			<select id="date-format" class="select rounded flex-1" bind:value={dateFormat}>
				{#each dateFormatOptions as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
			{#if dateFormatDirty}
				<button
					type="button"
					class="btn btn-outline btn-error btn-sm btn-square rounded"
					title="Revert change"
					onclick={() => (dateFormat = savedDateFormat)}
				>
					<RotateCcw size={16} />
				</button>
			{/if}
		</div>
	</div>

	<Fab Icon={Check} onclick={saveSettings} />
</main>
