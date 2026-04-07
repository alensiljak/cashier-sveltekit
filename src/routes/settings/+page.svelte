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

	Notifier.init();

	let rememberLastTransaction = $state<boolean>();
	let rootInvestmentAccount = $state<string>();
	let currency = $state<string>();
	let configSource = $state<LedgerDataSource>(LedgerDataSource.filesystem);

	onMount(async () => {
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

	<hr class="my-6" />

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
</main>
