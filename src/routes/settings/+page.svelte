<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import appService from '$lib/services/appService';
	import { goto } from '$app/navigation';
	import { LedgerDataSource } from '$lib/enums';
	import { DefaultCurrencyStore } from '$lib/data/mainStore.js';
	import { invalidateStorageBackendCache } from '$lib/storage/index.js';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { BoxIcon, Check } from '@lucide/svelte';
	import Fab from '$lib/components/FAB.svelte';
	import { page } from '$app/state';

	Notifier.init();

	let rememberLastTransaction = $state<boolean>();
	let rootInvestmentAccount = $state<string>();
	let currency = $state<string>();
	let configSource = $state<LedgerDataSource>(LedgerDataSource.filesystem);
	let bookFilename = $state<string | null>(null);
	let assetAllocationDefinition = $state<string | null>(null);

	onMount(async () => {
		// Handle return from file picker
		const settingKey = page.url.searchParams.get('settingKey');
		const settingValue = page.url.searchParams.get('settingValue');
		if (settingKey && settingValue) {
			await settings.set(settingKey, settingValue);
			// Remove params from URL without triggering navigation
			const url = new URL(window.location.href);
			url.searchParams.delete('settingKey');
			url.searchParams.delete('settingValue');
			history.replaceState({}, '', url.toString());
		}

		// load data
		currency = await appService.getDefaultCurrency();
		rootInvestmentAccount = (await settings.get<string>(
			SettingKeys.rootInvestmentAccount
		)) as string;
		rememberLastTransaction = (await settings.get<boolean>(
			SettingKeys.rememberLastTransaction
		)) as boolean;
		const dataSource = (await settings.get<string>(SettingKeys.ledgerDataSource)) ?? '';
		if (dataSource) configSource = dataSource as LedgerDataSource;

		bookFilename = (await settings.get<string>(SettingKeys.bookFilename)) ?? null;
		assetAllocationDefinition =
			(await settings.get<string>(SettingKeys.assetAllocationDefinition)) ?? null;
	});

	async function onConfigSourceChanged() {
		await settings.set(SettingKeys.ledgerDataSource, configSource);
	}

	function onConfigureClick() {
		switch (configSource) {
			case LedgerDataSource.filesystem:
				goto('/settings/filesystem');
				break;
			case LedgerDataSource.beancount:
				goto('/settings/beancount');
				break;
			case LedgerDataSource.rledger:
				Notifier.warning('Configure Cashier Server (Rust Ledger) - Not implemented yet.');
				break;
			case LedgerDataSource.ledger:
				Notifier.warning('Configure Cashier Server (Ledger-cli) - Not implemented yet.');
				break;
		}
	}

	async function onOpfsClick() {
		await goto('/opfs');
	}

	async function saveSettings() {
		await settings.set(SettingKeys.currency, currency);
		DefaultCurrencyStore.set(currency as string);

		await settings.set(SettingKeys.rootInvestmentAccount, rootInvestmentAccount);
		await settings.set(SettingKeys.rememberLastTransaction, rememberLastTransaction);

		invalidateStorageBackendCache();

		Notifier.success('Settings saved');

		history.back();
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
		<label for="currency" class="label">
			<span class="label-text">Main Currency</span>
		</label>
		<input
			id="currency"
			class="input rounded"
			type="text"
			placeholder="Main Currency"
			bind:value={currency}
		/>
	</div>
	<!-- investment account -->
	<div class="form-control w-full">
		<label for="investment-account-root" class="label">
			<span class="label-text">Investment account root</span>
		</label>
		<input
			id="investment-account-root"
			class="input rounded"
			type="text"
			placeholder="Investment account root"
			bind:value={rootInvestmentAccount}
		/>
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

	<Fab Icon={Check} onclick={saveSettings} />

	<hr class="my-6 mx-4" />

	<div class="flex gap-6">
		<div>
			<p class="mb-2 font-medium">Select the data source:</p>
			<form class="space-y-2">
				<label class="flex items-center space-x-2">
					<input
						class="radio radio-primary bg-base-100"
						type="radio"
						name="config-source"
						value={LedgerDataSource.filesystem}
						bind:group={configSource}
						onchange={onConfigSourceChanged}
					/>
					<span>Local filesystem</span>
				</label>
				<label class="flex items-center space-x-2">
					<input
						class="radio radio-primary bg-base-100"
						type="radio"
						name="config-source"
						value={LedgerDataSource.rledger}
						bind:group={configSource}
						onchange={onConfigSourceChanged}
					/>
					<span>Cashier Server (Rust Ledger)</span>
				</label>
				<label class="flex items-center space-x-2">
					<input
						class="radio radio-primary bg-base-100"
						type="radio"
						name="config-source"
						value={LedgerDataSource.beancount}
						bind:group={configSource}
						onchange={onConfigSourceChanged}
					/>
					<span>Cashier Server (Beancount)</span>
				</label>
				<label class="flex items-center space-x-2">
					<input
						class="radio radio-primary bg-base-100"
						type="radio"
						name="config-source"
						value={LedgerDataSource.ledger}
						bind:group={configSource}
						onchange={onConfigSourceChanged}
					/>
					<span>Cashier Server (Ledger-cli)</span>
				</label>
			</form>
		</div>
		<div class="flex flex-1 items-center justify-center">
			<button class="btn btn-outline btn-primary rounded" type="button" onclick={onConfigureClick}>
				Configure
			</button>
		</div>
	</div>

	<hr class="my-6 mx-4" />

	<div class="flex flex-col space-y-4">
		<h3 class="text-xl font-bold">Ledger Configuration</h3>

		<div class="flex items-center gap-4">
			<div class="flex-1">
				<p class="text-sm font-medium">Book file</p>
				<p class="font-mono text-sm opacity-70">{bookFilename ?? 'Not set'}</p>
			</div>
			<button
				class="btn btn-primary btn-sm rounded"
				type="button"
				onclick={() => goto(`/opfs/file-picker?returnSetting=${SettingKeys.bookFilename}`)}
			>
				Select
			</button>
		</div>

		<div class="flex items-center gap-4">
			<div class="flex-1">
				<p class="text-sm font-medium">Asset allocation definition</p>
				<p class="font-mono text-sm opacity-70">{assetAllocationDefinition ?? 'Not set'}</p>
			</div>
			<button
				class="btn btn-primary btn-sm rounded"
				type="button"
				onclick={() => goto(`/opfs/file-picker?returnSetting=${SettingKeys.assetAllocationDefinition}`)}
			>
				Select
			</button>
		</div>
	</div>
</main>
