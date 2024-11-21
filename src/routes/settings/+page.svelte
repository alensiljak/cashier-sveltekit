<script lang="ts">
	import { onMount } from 'svelte';
	import GlossToolbar from '$lib/gloss-toolbar.svelte';
	import Toolbar from '$lib/toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notify from '$lib/notify';

	let currency: string = '';
	let rootInvestmentAccount: string = '';
	let rememberLastTransaction: boolean | undefined = undefined;

	Notify.init()

	onMount(async () => {
		// console.log('the component has mounted');
		await loadSettings();
	});

	async function loadSettings() {
		console.log('loading settings');

		currency = await settings.get(SettingKeys.currency);
		// root investment account
		// remember last transaction
	}

	async function saveSettings() {
		await settings.set(SettingKeys.currency, currency);
		await settings.set(SettingKeys.rootInvestmentAccount, rootInvestmentAccount);
		await settings.set(SettingKeys.rememberLastTransaction, rememberLastTransaction);

		//   $q.notify({ message: 'Settings saved', color: 'positive' })
		Notify.notify('Settings saved', 'variant-filled-primary')
	}
</script>

<!-- <GlossToolbar /> -->

<Toolbar title="Settings" />

<main class="container space-y-4 p-1">
	<!-- currency -->
	<label class="label">
		<span>Main Currency</span>
		<input class="input" type="text" placeholder="Main Currency" bind:value={currency} />
	</label>
	<!-- investment account -->
	<label class="label">
		<span>Investment account root</span>
		<input class="input" type="text" placeholder="Investment account root" />
	</label>

	<!-- last transaction -->
	<label class="flex items-center space-x-2">
		<input class="checkbox" type="checkbox" />
		<p>Remember last transaction for payees.</p>
	</label>

	<!-- <label class="flex items-center space-x-2">
		<input class="checkbox" type="checkbox" checked />
		<p>Dark mode</p>
	</label> -->

	<center>
		<button class="variant-filled-error btn uppercase !text-warning-500" on:click={saveSettings}>
			Save
		</button>
	</center>

	<section>Import Asset Allocation file</section>

	<section>Restore Settings from file</section>

	<section>Reload App</section>
</main>
