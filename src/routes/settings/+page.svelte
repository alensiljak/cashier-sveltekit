<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import appService from '$lib/services/appService';
	import { goto, replaceState } from '$app/navigation';
	import { DefaultCurrencyStore } from '$lib/data/mainStore.js';
	// import { invalidateStorageBackendCache } from '$lib/storage/index.js';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { BoxIcon, Check } from '@lucide/svelte';
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

	onMount(async () => {
		// Handle return from file picker
		await handleFilePickerReturn();

		// load data
		await loadData();
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
				await settings.set(settingKey, settingValue);
				// assetAllocationDefinition = settingValue;
				break;
			default:
				console.warn(`Unknown setting key returned from file picker: ${settingKey}`);
				return; // Don't save unknown settings
		}

		// Remove params from URL without triggering navigation
		const url = new URL(window.location.href);
		url.searchParams.delete('settingKey');
		url.searchParams.delete('settingValue');
		replaceState('', {});
	}

	async function loadData() {
		currency = await appService.getDefaultCurrency();
		bookCurrencies = await fullLedgerService.getOperatingCurrencies();
		if (!currency && bookCurrencies.length > 0) {
			// load from the ledger
			currency = bookCurrencies[0];
			// save to settings for next time
			await settings.set(SettingKeys.currency, currency);
		}

		rootInvestmentAccount = (await settings.get<string>(
			SettingKeys.rootInvestmentAccount
		)) as string;
		rememberLastTransaction = (await settings.get<boolean>(
			SettingKeys.rememberLastTransaction
		)) as boolean;

		if (!bookFilename) {
			bookFilename = await appService.readBookFilename();
		}

		assetAllocationDefinition =
			(await settings.get<string>(SettingKeys.assetAllocationDefinition)) ?? null;
	}

	async function onOpfsClick() {
		await goto('/opfs');
	}

	async function saveSettings() {
		await settings.set(SettingKeys.currency, currency);
		DefaultCurrencyStore.set(currency as string);

		await settings.set(SettingKeys.rootInvestmentAccount, rootInvestmentAccount);
		await settings.set(SettingKeys.rememberLastTransaction, rememberLastTransaction);

		// Save book filename in cashier.bean
		if (bookFilename) {
			await appService.writeBookFilename(bookFilename);
		}

		// invalidateStorageBackendCache();

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
		<input
			id="currency"
			class="input rounded"
			type="text"
			placeholder="EUR, USD, etc."
			bind:value={currency}
		/>
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
		<input
			id="investment-account-root"
			class="input rounded"
			type="text"
			placeholder="i.e. Assets:Investments"
			bind:value={rootInvestmentAccount}
		/>
	</div>

	<Fab Icon={Check} onclick={saveSettings} />
</main>
