<script lang="ts">
	import { onMount } from 'svelte';
	import GlossToolbar from '$lib/components/gloss-toolbar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import { FileButton } from '@skeletonlabs/skeleton';
	import db from '$lib/data/db';
	import appService from '$lib/services/appService';
	import { invalidateAll } from '$app/navigation';
	import * as OpfsLib from '$lib/utils/opfslib.js';
	import { AssetAllocationFilename } from '$lib/constants.js';
	import { DefaultCurrencyStore } from '$lib/data/mainStore.js';
	import { Modal } from '@skeletonlabs/skeleton-svelte';

	Notifier.init();
	let isAaConfirmationOpen = $state(false);
	let isSettingsConfirmationOpen = $state(false);

	// let data: PageData = $props();
	let rememberLastTransaction = $state<boolean>();
	let rootInvestmentAccount = $state<string>();
	let currency = $state<string>();

	let settings_files = $state<FileList>();
	let aa_files = $state<FileList>();

	onMount(async () => {
		currency = await appService.getDefaultCurrency();
		rootInvestmentAccount = await settings.get<string>(SettingKeys.rootInvestmentAccount);
		rememberLastTransaction = await settings.get<boolean>(SettingKeys.rememberLastTransaction);
	});

	/**
	 * Close all dialogs.
	 */
	function closeModal() {
		isAaConfirmationOpen = false;
		isSettingsConfirmationOpen = false;
	}

	async function onAaFileChanged() {
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
	async function onSettingsFileChangeHandler() {
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

		// todo: reset AA cache

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
		<button class="variant-filled-error btn uppercase !text-warning-500" onclick={saveSettings}>
			Save
		</button>
	</center>

	<section>
		<h3 class="h3">Asset Allocation</h3>
		<center>
			<FileButton
				name="aa_file"
				button="btn variant-soft-primary"
				bind:files={aa_files}
				on:change={onAaFileChanged}
			/>
		</center>
	</section>

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

	<!-- <section>
		Reload App
	</section> -->
</main>

<!-- "AA import" dialog -->
<Modal
	bind:open={isAaConfirmationOpen}
	triggerBase="hidden"
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-screen-sm"
	backdropClasses="backdrop-blur-sm"
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
			<button type="button" class="variant-tonal btn" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn-primary variant-filled-primary btn text-tertiary-500"
				onclick={onAaImportConfirmed}>OK</button
			>
		</footer>
	{/snippet}
</Modal>
<!-- "Settings import" dialog -->
<Modal
	bind:open={isSettingsConfirmationOpen}
	triggerBase="hidden"
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-screen-sm"
	backdropClasses="backdrop-blur-sm"
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
			<button type="button" class="variant-tonal btn" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn-primary variant-filled-primary btn text-tertiary-500"
				onclick={onSettingsRestoreConfirmed}>OK</button
			>
		</footer>
	{/snippet}
</Modal>
