<script lang="ts">
	import { page } from '$app/stores';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import appService from '$lib/services/appService';
	import Notifier from '$lib/utils/notifier';
	import { CopyIcon, FileDownIcon } from 'lucide-svelte';
	import moment from 'moment';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	const dataType = $page.params.dataType;

	let output = $state('');

	if (navigator.share !== undefined) {
		console.log('can share');
	} else {
		console.log('native sharing not supported');
	}

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		switch (dataType) {
			case 'journal':
				// The default, old behaviour: use transactions
				output = await appService.getExportTransactions();
				break;
			case 'scheduled':
				output = await loadScheduledTransactions();
				break;
		}
	}

	/**
	 * Returns the file extension based on the export data type.
	 */
	function getFileExtension(): string {
		// extension
		let extension = 'txt';

		switch (dataType) {
			case 'journal':
				extension = 'ledger';
				break;
			case 'scheduled':
				extension = 'json';
				break;
		}
		return extension;
	}

	/**
	 * Generates the file name for the export file, when downloading.
	 */
	function getFilename(): string {
		// create the file name for the downloaded export file.
		let extension = getFileExtension();
		// filename
		const now = moment().format('YYYY-MM-DD_HH-mm');
		let filename = `cashier_${dataType}_${now}.${extension}`;
		return filename;
	}

	async function loadScheduledTransactions() {
		const collection = await appService.db.scheduled.orderBy('nextDate').toArray();
		const output = JSON.stringify(collection);
		return output;
	}

	async function onCopyClick() {
		if (!output) {
			Notifier.warn('The content is empty.');
			return;
		}

		await navigator.clipboard.writeText(output);

		Notifier.success('Data copied to clipboard');
	}

	async function onDownloadClick() {
		let fileName = getFilename();

		// Save file
		const blob = new Blob([output], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);

		var link = document.createElement('a');
		link.download = fileName;
		// link.href = "data:text/plain;charset=utf-8," + encodeURIComponent(content);
		link.href = url;

		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Export {dataType}" />

	<main class="flex h-full flex-col p-1">
		<p>Note: Journal is exported in ledger format, Scheduled Transactions in JSON.</p>

		<textarea
			class="textarea mt-3 grow overflow-auto p-2"
			rows="20"
			placeholder="Enter some long form content."
			bind:value={output}
		></textarea>

		<!-- action buttons -->
		<div class="my-3 flex flex-row justify-center space-x-24 py-3">
			<!-- copy to clipboard -->
			<button class="variant-filled-primary btn" onclick={onCopyClick}>
				<CopyIcon />
				<span>Copy</span>
			</button>
			<!-- pCloud Save ?-->
			<!-- WebShare -->
			<!-- Download -->
			<button class="variant-filled-primary btn" onclick={onDownloadClick}>
				<FileDownIcon />
				<span>Download</span>
			</button>
		</div>
	</main>
</article>
