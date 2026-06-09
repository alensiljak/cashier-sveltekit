<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import {
		DEFAULT_CREDIT_CARD_ROOT_ACCOUNT,
		type CreditCardSettings,
		SettingKeys,
		settings
	} from '$lib/settings';
	import { CheckIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let rootAccount = $state(DEFAULT_CREDIT_CARD_ROOT_ACCOUNT);
	let paymentDay = $state(1);
	let paymentAccount = $state('');
	let allAccounts: string[] = $state([]);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		const saved = await settings.get<CreditCardSettings>(SettingKeys.creditCardSettings);
		if (saved) {
			rootAccount = saved.rootAccount ?? DEFAULT_CREDIT_CARD_ROOT_ACCOUNT;
			paymentDay = saved.paymentDay ?? 1;
			paymentAccount = saved.paymentAccount ?? '';
		}

		await fullLedgerService.ensureLoaded();
		const accounts = await fullLedgerService.getAllAccounts();
		allAccounts = (accounts as { name: string }[]).map((a) => a.name);
	}

	async function onFabClicked() {
		const config: CreditCardSettings = {
			rootAccount,
			paymentDay,
			paymentAccount
		};
		await settings.set(SettingKeys.creditCardSettings, config);
		history.back();
	}
</script>

<Toolbar title="Credit Card Settings" />

<Fab Icon={CheckIcon} onclick={onFabClicked} />

<main class="p-2 space-y-4">
	<section>
		<h4 class="h4 mb-1">Root Account</h4>
		<p class="text-sm text-base-content/60 mb-2">
			All sub-accounts of this account are treated as credit card accounts.
		</p>
		<SearchableSelect
			options={allAccounts}
			bind:value={rootAccount}
			placeholder={DEFAULT_CREDIT_CARD_ROOT_ACCOUNT}
		/>
	</section>

	<section>
		<h4 class="h4 mb-1">Payment Account</h4>
		<p class="text-sm text-base-content/60 mb-2">
			Asset account that the credit card balance is paid from.
		</p>
		<SearchableSelect options={allAccounts} bind:value={paymentAccount} placeholder="e.g. Assets:Checking" />
	</section>

	<section>
		<h4 class="h4 mb-1">Payment Day of Month</h4>
		<p class="text-sm text-base-content/60 mb-2">
			Day each month when the credit card balance is deducted from your assets.
		</p>
		<input
			type="number"
			class="input text-right w-full"
			min="1"
			max="28"
			bind:value={paymentDay}
		/>
	</section>
</main>
