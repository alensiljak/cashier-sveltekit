<script lang="ts">
	import { onMount } from 'svelte';
	// import GlossToolbar from '$lib/components/gloss-toolbar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import db from '$lib/data/db';
	import appService from '$lib/services/appService';
	import { invalidateAll } from '$app/navigation';
	import * as OpfsLib from '$lib/utils/opfslib.js';
	import { AssetAllocationFilename } from '$lib/constants.js';
	import { AssetAllocationEngine } from '$lib/assetAllocation/AssetAllocation';
	import { validate } from '$lib/assetAllocation/assetAllocationValidation';
	import {
		AaStocksStore,
		AssetAllocationStore,
		DefaultCurrencyStore
	} from '$lib/data/mainStore.js';
	// import type { FileChangeDetails } from '@zag-js/file-upload';

	type FileChangeDetails = {
		acceptedFiles: File[];
	};

	Notifier.init();
	let isAaConfirmationOpen = $state(false);
	let isSettingsConfirmationOpen = $state(false);

	// let data: PageData = $props();
	let rememberLastTransaction = $state<boolean>();
	let rootInvestmentAccount = $state<string>();
	let currency = $state<string>();
	let ptaSystem = $state<string>();

	let settings_files = $state<File[]>();
	let aa_files = $state<File[]>();

	onMount(async () => {
		// load data
		currency = await appService.getDefaultCurrency();
		rootInvestmentAccount = await settings.get<string>(SettingKeys.rootInvestmentAccount);
		rememberLastTransaction = await settings.get<boolean>(SettingKeys.rememberLastTransaction);
		ptaSystem = await settings.get<string>(SettingKeys.ptaSystem);
	});

	/**
	 * Close all dialogs.
	 */
	function closeModal() {
		isAaConfirmationOpen = false;
		isSettingsConfirmationOpen = false;
	}

	async function onAaFileChanged(details: FileChangeDetails) {
		aa_files = details.acceptedFiles;

		isAaConfirmationOpen = true;
	}

	async function onAaImportConfirmed() {
		closeModal();

		await restoreAssetAllocation();
	}

	/**
	 * Handles the change of the settings file selection.
	 * When the file is selected, automatically offer to import it.
	 */
	async function onSettingsFileChangeHandler(details: FileChangeDetails) {
		settings_files = details.acceptedFiles;

		// prompt for confirmation with a dialog
		isSettingsConfirmationOpen = true;
	}

	async function onSettingsRestoreConfirmed() {
		closeModal();

		await restoreSettings();
	}

	async function restoreAssetAllocation() {
		if (aa_files?.length === 0) {
			console.error('no files selected!');
			return;
		}
		let file = aa_files?.[0];
		const contents: any = await appService.readFileAsync(file as Blob);

		// save to OPFS
		try {
			const engine = new AssetAllocationEngine();
			engine.parseForValidation(contents);

			const errors = validate(engine);
			if (errors.length > 0) {
				Notifier.error('Invalid Asset Allocation: ' + errors.join(' '));
				return;
			}
		} catch (error) {
			Notifier.error(`Failed to parse Asset Allocation file: ${error}`);
			return;
		}

		await OpfsLib.saveFile(AssetAllocationFilename, contents);

		// reset AA cache
		AssetAllocationStore.set(undefined);
		AaStocksStore.set(undefined);

		Notifier.success('Asset Allocation imported');
	}

	/**
	 * Restore the selected settings file.
	 */
	async function restoreSettings() {
		if (settings_files?.length === 0) {
			console.error('no files selected!');
			return;
		}
		let file = settings_files?.[0];
		const contents: string = await appService.readFileAsync(file as Blob);

		// clear settings table
		await db.settings.clear();

		// store the new settings from json
		const records = JSON.parse(contents);
		await db.settings.bulkAdd(records);

		Notifier.success('Settings imported');

		invalidateAll();
	}

	async function saveSettings() {
		await settings.set(SettingKeys.currency, currency);
		DefaultCurrencyStore.set(currency as string);

		await settings.set(SettingKeys.rootInvestmentAccount, rootInvestmentAccount);
		await settings.set(SettingKeys.rememberLastTransaction, rememberLastTransaction);

		await settings.set(SettingKeys.ptaSystem, ptaSystem);

		Notifier.success('Settings saved');
	}
</script>

<!-- <GlossToolbar /> -->

<Toolbar title="Settings" />

<main class="mx-auto max-w-6xl space-y-4 p-1">
	<!-- currency -->
	<div class="form-control w-full">
		<label class="label">
			<span class="label-text">Main Currency</span>
		</label>
		<input class="input rounded" type="text" placeholder="Main Currency" bind:value={currency} />
	</div>
	<!-- investment account -->
	<div class="form-control w-full">
		<label class="label">
			<span class="label-text">Investment account root</span>
		</label>
		<input
			class="input rounded"
			type="text"
			placeholder="Investment account root"
			bind:value={rootInvestmentAccount}
		/>
	</div>

	<!-- last transaction -->
	<label class="flex items-center space-x-2">
		<input
			class="checkbox checkbox-primary rounded"
			type="checkbox"
			bind:checked={rememberLastTransaction}
		/>
		<p>Remember last transaction for payees.</p>
	</label>

	<!-- ledger / beancount -->
	<p>Select the default plain-text-account system:</p>
	<form class="space-y-2">
		<label class="flex items-center space-x-2">
			<input
				class="radio radio-primary bg-base-100"
				type="radio"
				name="radio-direct"
				value="beancount"
				bind:group={ptaSystem}
			/>
			<p>Beancount</p>
		</label>
		<label class="flex items-center space-x-2">
			<input
				class="radio radio-primary bg-base-100"
				type="radio"
				checked
				name="radio-direct"
				value="ledger"
				bind:group={ptaSystem}
			/>
			<p>Ledger-cli</p>
		</label>
	</form>

	<center>
		<button class="btn btn-secondary text-accent rounded uppercase" onclick={saveSettings}>
			Save
		</button>
	</center>

	<hr />

	<section>
		<h3 class="mb-2 text-2xl font-semibold">Asset Allocation</h3>
		<fieldset class="fieldset">
			<center>
				<input
					type="file"
					name="aa_file"
					accept=".toml"
					class="file-input file-input-primary rounded"
					onchange={(e) => {
						const target = e.target as HTMLInputElement;
						onAaFileChanged({ acceptedFiles: Array.from(target.files || []) });
					}}
				/>
				<label class="label"> Select the AA definition </label>
			</center>
		</fieldset>
	</section>

	<section>
		<h3 class="mb-2 text-2xl font-semibold">Restore Settings</h3>
		<p>
			This functionality is now redundant. You can use Backup/Restore, which also includes Settings.
		</p>
		<fieldset>
			<center>
				<input
					type="file"
					name="settings_file"
					accept=".json"
					class="file-input file-input-primary rounded"
					onchange={(e) => {
						const target = e.target as HTMLInputElement;
						onSettingsFileChangeHandler({ acceptedFiles: Array.from(target.files || []) });
					}}
				/>
				<label class="label"> Select the settings file </label>
			</center>
		</fieldset>
	</section>

	<!-- <section>
		Reload App
	</section> -->
</main>

<!-- "AA import" dialog -->
<input
	type="checkbox"
	id="aa-confirmation-modal"
	class="modal-toggle"
	bind:checked={isAaConfirmationOpen}
/>
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Confirm Restore</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">Do you want to import the selected Asset Allocation file?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary text-primary-content"
				onclick={onAaImportConfirmed}>OK</button
			>
		</footer>
	</div>
</dialog>

<!-- "Settings import" dialog -->
<input
	type="checkbox"
	id="settings-confirmation-modal"
	class="modal-toggle"
	bind:checked={isSettingsConfirmationOpen}
/>
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Confirm Restore</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">Do you want to restore the selected settings file?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary text-primary-content"
				onclick={onSettingsRestoreConfirmed}>OK</button
			>
		</footer>
	</div>
</dialog>
