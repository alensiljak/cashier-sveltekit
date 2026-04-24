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
	import { BoxIcon, Check, RotateCcw } from '@lucide/svelte';
	import Fab from '$lib/components/FAB.svelte';
	import { page } from '$app/state';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import { USER_BOOK_FILENAME } from '$lib/constants';

	Notifier.init();

	let rememberLastTransaction = $state<boolean>();
	let currency = $state<string>();
	let bookCurrencies = $state<string[]>([]);
	let bookFilename = $state<string | null>(null);
	let assetAllocationDefinition = $state<string | null>(null);
	let rootInvestmentAccount = $state<string>();
	let loaded = $state(false);

	// Saved (DB) values for revert comparison
	let savedCurrency = $state<string | undefined>(undefined);
	let savedBookFilename = $state<string | null>(null);
	let savedAssetAllocationDefinition = $state<string | null>(null);
	let savedRootInvestmentAccount = $state<string | undefined>(undefined);
	let savedRememberLastTransaction = $state<boolean | undefined>(undefined);

	// Dirty flags — only meaningful after initial load
	let currencyDirty = $derived(loaded && currency !== savedCurrency);
	let bookFilenameDirty = $derived(loaded && bookFilename !== savedBookFilename);
	let assetAllocationDirty = $derived(
		loaded && assetAllocationDefinition !== savedAssetAllocationDefinition
	);
	let rootInvestmentDirty = $derived(loaded && rootInvestmentAccount !== savedRootInvestmentAccount);

	// Save form state before navigating away (e.g. to file picker)
	beforeNavigate(() => {
		if (loaded) {
			PendingSettingsStore.set({
				currency,
				rememberLastTransaction,
				bookFilename,
				assetAllocationDefinition,
				rootInvestmentAccount
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
		savedRootInvestmentAccount = (await settings.get<string>(
			SettingKeys.rootInvestmentAccount
		)) as string | undefined;
		savedRememberLastTransaction = (await settings.get<boolean>(
			SettingKeys.rememberLastTransaction
		)) as boolean | undefined;
		savedAssetAllocationDefinition =
			(await settings.get<string>(SettingKeys.assetAllocationDefinition)) ?? null;

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
			assetAllocationDefinition = pending?.assetAllocationDefinition ?? savedAssetAllocationDefinition;
		rootInvestmentAccount = pending?.rootInvestmentAccount ?? savedRootInvestmentAccount;
	}

	async function onOpfsClick() {
		await goto('/opfs');
	}

	async function saveSettings() {
		await settings.set(SettingKeys.currency, currency);
		DefaultCurrencyStore.set(currency as string);

		await settings.set(SettingKeys.rootInvestmentAccount, rootInvestmentAccount);
		await settings.set(SettingKeys.rememberLastTransaction, rememberLastTransaction);
		await settings.set(SettingKeys.assetAllocationDefinition, assetAllocationDefinition);

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

	<Fab Icon={Check} onclick={saveSettings} />
</main>
