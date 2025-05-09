<script lang="ts">
	import { onMount } from 'svelte';
	// import GlossToolbar from '$lib/components/gloss-toolbar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import { FileUpload, Modal } from '@skeletonlabs/skeleton-svelte';
	import db from '$lib/data/db';
	import appService from '$lib/services/appService';
	import { invalidateAll } from '$app/navigation';
	import * as OpfsLib from '$lib/utils/opfslib.js';
	import { AssetAllocationFilename } from '$lib/constants.js';
	import { AaStocksStore, AssetAllocationStore, DefaultCurrencyStore } from '$lib/data/mainStore.js';
	import type { FileChangeDetails } from '@zag-js/file-upload';

	Notifier.init();
	let isAaConfirmationOpen = $state(false);
	let isSettingsConfirmationOpen = $state(false);

	// let data: PageData = $props();
	let rememberLastTransaction = $state<boolean>();
	let rootInvestmentAccount = $state<string>();
	let currency = $state<string>();
	let ptaSystem = $state<string>()

	let settings_files = $state<File[]>();
	let aa_files = $state<File[]>();

	onMount(async () => {
		// load data
		currency = await appService.getDefaultCurrency();
		rootInvestmentAccount = await settings.get<string>(SettingKeys.rootInvestmentAccount);
		rememberLastTransaction = await settings.get<boolean>(SettingKeys.rememberLastTransaction);
		ptaSystem = await settings.get<string>(SettingKeys.ptaSystem)
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
		const contents: any = await appService.readFileAsync(file as Blob);

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

		await settings.set(SettingKeys.ptaSystem, ptaSystem)

		Notifier.success('Settings saved');
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

	<!-- ledger / beancount -->
	<p>Select the default plain-text-account system:</p>
	<form class="space-y-2">
		<label class="flex items-center space-x-2">
			<input class="radio" type="radio" name="radio-direct" value="beancount" bind:group={ptaSystem} />
			<p>Beancount</p>
		</label>
		<label class="flex items-center space-x-2">
			<input class="radio" type="radio" checked name="radio-direct" value="ledger" bind:group={ptaSystem} />
			<p>Ledger-cli</p>
		</label>
	</form>

	<center>
		<button class="preset-filled-error-500 btn uppercase text-warning-500!" onclick={saveSettings}>
			Save
		</button>
	</center>

	<hr />

	<section>
		<h3 class="h3">Asset Allocation</h3>
		<center>
			<FileUpload
				name="aa_file"
				onFileChange={onAaFileChanged}>
				<button class="btn preset-tonal-primary">
					<span>Select the AA definition</span>
				</button>
			</FileUpload>
		</center>
	</section>

	<section>
		<h3 class="h3">Restore Settings</h3>
		<p>This functionality is now redundant. You can use Backup/Restore, which also includes Settings.</p>
		<center>
			<FileUpload
				name="settings_file"
				onFileChange={onSettingsFileChangeHandler}>
				<button class="btn preset-tonal-primary">
					<span>Select the settings file</span>
			</FileUpload>
		</center>
	</section>

	<!-- <section>
		Reload App
	</section> -->
</main>

<!-- "AA import" dialog -->
<Modal
	open={isAaConfirmationOpen}
	triggerBase="hidden"
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-(--breakpoint-sm)"
	backdropClasses="backdrop-blur-xs"
>
	{#snippet trigger()}Open Modal{/snippet}
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h4">Confirm Restore</h2>
		</header>
		<article>
			<p class="opacity-60">Do you want to import the selected Asset Allocation file?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="preset-tonal btn" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn-primary preset-filled-primary-500 btn text-tertiary-500"
				onclick={onAaImportConfirmed}>OK</button
			>
		</footer>
	{/snippet}
</Modal>
<!-- "Settings import" dialog -->
<Modal
	open={isSettingsConfirmationOpen}
	triggerBase="hidden"
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-(--breakpoint-sm)"
	backdropClasses="backdrop-blur-xs"
>
	{#snippet trigger()}Open Modal{/snippet}
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h4">Confirm Restore</h2>
		</header>
		<article>
			<p class="opacity-60">Do you want to restore the selected settings file?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="preset-tonal btn" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn-primary preset-filled-primary-500 btn text-tertiary-500"
				onclick={onSettingsRestoreConfirmed}>OK</button
			>
		</footer>
	{/snippet}
</Modal>
