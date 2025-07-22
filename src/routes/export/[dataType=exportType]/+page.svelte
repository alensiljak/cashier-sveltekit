<script lang="ts">
	import { page } from '$app/state';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import appService from '$lib/services/appService';
	import { getFilenameForBackup } from '$lib/services/cloudBackupService';
	import Notifier from '$lib/utils/notifier';
	import { CopyIcon, FileDownIcon, Share2Icon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	Notifier.init();

	const dataType = page.params.dataType;

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

	async function loadScheduledTransactions() {
		const collection = await appService.db.scheduled.orderBy('nextDate').toArray();
		const output = JSON.stringify(collection);
		return output;
	}

	async function onCopyClick() {
		if (!output) {
			Notifier.info('The content is empty.');
			return;
		}

		await navigator.clipboard.writeText(output);

		Notifier.success('Data copied to clipboard');
	}

	async function onDownloadClick() {
		let fileName = getFilenameForBackup(dataType);

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

	async function onShareClick() {
		if (!output) {
			Notifier.info('The content is empty.');
			return;
		}

		if (navigator.share) {
			await navigator.share({
				title: `Cashier ${dataType} export`,
				text: output
			});
		} else {
			Notifier.error('Web Share API not supported.');
		}
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Export {dataType}" />

	<main class="flex h-full flex-col p-1">
		<p>Note: Journal is exported in ledger format, Scheduled Transactions in JSON.</p>

		<textarea
			class="textarea mt-3 grow overflow-auto p-2 whitespace-nowrap"
			rows="20"
			placeholder="Enter some long form content."
			bind:value={output}
		></textarea>

		<!-- action buttons -->
		<div class="my-3 flex flex-row justify-center space-x-24 py-3">
			<!-- copy to clipboard -->
			<button class="preset-filled-primary-500 btn" onclick={onCopyClick}>
				<CopyIcon />
				<span>Copy</span>
			</button>
			<!-- pCloud Save ?-->
			<!-- WebShare -->
			<button class="preset-filled-primary-500 btn" onclick={onShareClick}>
				<Share2Icon />
				<span>Share</span>
			</button>
			<!-- Download -->
			<button class="preset-filled-primary-500 btn" onclick={onDownloadClick}>
				<FileDownIcon />
				<span>Download</span>
			</button>
		</div>
	</main>
</article>
