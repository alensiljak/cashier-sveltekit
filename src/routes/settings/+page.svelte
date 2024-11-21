<script lang="ts">
	import { onMount } from 'svelte';
	import GlossToolbar from '$lib/components/gloss-toolbar.svelte';
	import Toolbar from '$lib/components/toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import { FileButton, getModalStore, type ModalSettings } from '@skeletonlabs/skeleton';
	import { xact } from '$lib/data/mainStore';
	import { get } from 'svelte/store';
	import db from '$lib/data/db'
	import appService from '$lib/services/appService'

	const modalStore = getModalStore();
	Notifier.init();

	let currency: string = '';
	let rootInvestmentAccount: string = '';
	let rememberLastTransaction: boolean | undefined = undefined;
	let settings_files: FileList;

	onMount(async () => {
		// console.log('the component has mounted');
		await loadSettings();

		console.debug('xact is', get(xact));
	});

	async function loadSettings() {
		currency = await settings.get(SettingKeys.currency);
		rootInvestmentAccount = await settings.get(SettingKeys.rootInvestmentAccount);
		rememberLastTransaction = await settings.get(SettingKeys.rememberLastTransaction);
	}

	/**
	 * Handles the change of the settings file selection.
	 * When the file is selected, automatically offer to import it.
	 */
	async function onSettingsFileChangeHandler() {
		// prompt for confirmation with a dialog
		const modal: ModalSettings = {
			type: 'confirm',
			// Data
			title: 'Confirm Restore',
			body: 'Do you want to restore the selected settings file?',
			response: async (r: boolean) => {
				if (r) await restoreSettings();
			}
		};
		modalStore.trigger(modal);
	}

	/**
	 * Restore the selected settings file.
	 */
	async function restoreSettings() {
		if(settings_files.length === 0) {
			console.error('no files selected!')
			return
		}
		let file = settings_files[0]
		const contents: any = await appService.readFileAsync(file as Blob);

		// clear settings table
		await db.settings.clear();

		// store the new settings from json
		const records = JSON.parse(contents);
		await db.settings.bulkAdd(records);

		Notifier.notify('Settings imported', 'bg-primary-500')

		await loadSettings();
	}

	async function saveSettings() {
		await settings.set(SettingKeys.currency, currency);
		await settings.set(SettingKeys.rootInvestmentAccount, rootInvestmentAccount);
		await settings.set(SettingKeys.rememberLastTransaction, rememberLastTransaction);

		Notifier.notify('Settings saved', 'variant-filled-primary');
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
		<input
			class="input"
			type="text"
			placeholder="Investment account root"
			bind:value={rootInvestmentAccount}
		/>
	</label>

	<!-- last transaction -->
	<label class="flex items-center space-x-2">
		<input class="checkbox" type="checkbox" bind:checked={rememberLastTransaction} />
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

	<section>
		<h3 class="h3">Restore Settings</h3>
		<center>
			<FileButton
				name="settings_file"
				button="btn variant-soft-primary"
				bind:files={settings_files}
				on:change={onSettingsFileChangeHandler}
			/>
		</center>
	</section>

	<section>Reload App</section>
</main>
