<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import appService from '$lib/services/appService';
	import { goto } from '$app/navigation';
	import { DefaultCurrencyStore } from '$lib/data/mainStore.js';
	import { invalidateStorageBackendCache } from '$lib/storage/index.js';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { BoxIcon, Check } from '@lucide/svelte';
	import Fab from '$lib/components/FAB.svelte';

	type FileChangeDetails = {
		acceptedFiles: File[];
	};

	Notifier.init();

	let rememberLastTransaction = $state<boolean>();
	let rootInvestmentAccount = $state<string>();
	let currency = $state<string>();

	onMount(async () => {
		// load data
		currency = await appService.getDefaultCurrency();
		rootInvestmentAccount = (await settings.get<string>(
			SettingKeys.rootInvestmentAccount
		)) as string;
		rememberLastTransaction = (await settings.get<boolean>(
			SettingKeys.rememberLastTransaction
		)) as boolean;
	});

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

</main>
