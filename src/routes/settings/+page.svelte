<script lang="ts">
	import { onMount } from 'svelte';
	import GlossToolbar from '$lib/components/gloss-toolbar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import { FileButton, getModalStore, type ModalSettings } from '@skeletonlabs/skeleton';
	import db from '$lib/data/db';
	import appService from '$lib/services/appService';
	import { invalidate, invalidateAll } from '$app/navigation';
	import * as OpfsLib from '$lib/utils/opfslib.js'
	import { AssetAllocationFilename } from '$lib/constants.js';

	const modalStore = getModalStore();
	Notifier.init();

	export let data;

	let settings_files: FileList;
	let aa_files: FileList;

	onMount(async () => {
	});

	async function onAaFileChanged() {
		const modal: ModalSettings = {
			type: 'confirm',
			// Data
			title: 'Confirm Import',
			body: 'Do you want to import the selected Asset Allocation file?',
			response: async (r: boolean) => {
				if (r) await restoreAssetAllocation();
			}
		};
		modalStore.trigger(modal);
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

	async function restoreAssetAllocation() {
		if (aa_files.length === 0) {
			console.error('no files selected!');
			return;
		}
		let file = aa_files[0];
		const contents: any = await appService.readFileAsync(file as Blob);

		// save to OPFS
		await OpfsLib.saveFile(AssetAllocationFilename, contents)

		// todo: reset AA cache

		Notifier.success('Asset Allocation imported')
	}

	/**
	 * Restore the selected settings file.
	 */
	async function restoreSettings() {
		if (settings_files.length === 0) {
			console.error('no files selected!');
			return;
		}
		let file = settings_files[0];
		const contents: any = await appService.readFileAsync(file as Blob);

		// clear settings table
		await db.settings.clear();

		// store the new settings from json
		const records = JSON.parse(contents);
		await db.settings.bulkAdd(records);

		Notifier.success('Settings imported');

		invalidate('/settings')
		// await loadSettings();
	}

	async function saveSettings() {
		await settings.set(SettingKeys.currency, data.currency);
		await settings.set(SettingKeys.rootInvestmentAccount, data.rootInvestmentAccount);
		await settings.set(SettingKeys.rememberLastTransaction, data.rememberLastTransaction);

		Notifier.notify('Settings saved', 'variant-filled-primary');
	}
</script>

<!-- <GlossToolbar /> -->

<Toolbar title="Settings" />

<main class="container space-y-4 p-1">
	<!-- currency -->
	<label class="label">
		<span>Main Currency</span>
		<input class="input" type="text" placeholder="Main Currency" bind:value={data.currency} />
	</label>
	<!-- investment account -->
	<label class="label">
		<span>Investment account root</span>
		<input
			class="input"
			type="text"
			placeholder="Investment account root"
			bind:value={data.rootInvestmentAccount}
		/>
	</label>

	<!-- last transaction -->
	<label class="flex items-center space-x-2">
		<input class="checkbox" type="checkbox" bind:checked={data.rememberLastTransaction} />
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
