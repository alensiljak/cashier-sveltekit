<script lang="ts">
	import { page } from '$app/state';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import appService from '$lib/services/appService';
	import { getFilenameForBackup } from '$lib/services/cloudBackupService';
	import Notifier from '$lib/utils/notifier';
	import { CopyIcon, FileDownIcon, Share2Icon } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { CASHIER_XACT_FILE } from '$lib/constants';

	Notifier.init();

	const dataType = page.params.dataType;

	let output = $state('');
	let canUseWebShare = $state(false);

	onMount(async () => {
		canUseWebShare = supportsWebShare();

		await loadData();
	});

	function supportsWebShare() {
		if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
			return false;
		}

		if (!window.isSecureContext) {
			return false;
		}

		if (typeof navigator.canShare !== 'function') {
			return true;
		}

		const shareFile = new File([''], CASHIER_XACT_FILE, { type: 'text/plain' });
		return navigator.canShare({ files: [shareFile] });
	}

	async function loadData() {
		switch (dataType) {
			case 'journal':
				output = await appService.stripIncludesFromBookFile();
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
		let fileName = getFilenameForBackup(dataType as string);

		// Save file
		const blob = new Blob([output], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);

		const link = document.createElement('a');
		link.download = fileName;
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

		// let fileName = getFilenameForBackup(dataType as string);
		// const file = new File([output], fileName, { type: 'text/plain' });

		if (!window.isSecureContext) {
			Notifier.error('Sharing requires a secure context (HTTPS or localhost). Please use Download instead.');
			return;
		}
		if (!navigator.canShare) {
			Notifier.error('This browser does not support sharing. Please use Download instead.');
			return;
		}
		// if (!navigator.canShare({ files: [file] })) {
		// 	Notifier.error('This browser cannot share files from this page. Please use Download instead.');
		// 	return;
		// }

		const today = new Date().toISOString().slice(0, 10);

		try {
			await navigator.share({
				// files: [file],
				title: `Cashier ${dataType} export (${today})`,
				// text: `Cashier ${dataType} export`
				text: output
			});
		} catch (error: unknown) {
			if (error instanceof DOMException) {
				switch (error.name) {
					case 'AbortError':
						Notifier.info('Share canceled.');
						return;
					case 'NotAllowedError':
						Notifier.error(
							'File sharing is not supported in this browser. Please use Download instead.'
						);
						return;
					case 'InvalidStateError':
						Notifier.error('A share operation is already in progress. Please try again in a moment.');
						return;
				}
			}

			console.error('Share failed', error);
			Notifier.error('Unable to share in this browser. Please use Download instead.');
		}
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Export {dataType}" />

	<main class="flex flex-col p-1 grow overflow-auto">
		<p>Note: Journal is exported in ledger format, Scheduled Transactions in JSON.</p>

		<textarea
			class="textarea mt-3 overflow-auto p-2 whitespace-nowrap w-full"
			rows="20"
			placeholder="Enter some long form content."
			bind:value={output}
		></textarea>

		<!-- action buttons -->
		<div
			class="my-3 grid gap-3 py-3"
			class:grid-cols-3={canUseWebShare}
			class:grid-cols-2={!canUseWebShare}
		>
			<!-- copy to clipboard -->
			<button class="btn btn-primary w-full" onclick={onCopyClick}>
				<CopyIcon />
				<span>Copy</span>
			</button>
			<!-- pCloud Save ?-->
			<!-- WebShare -->
			{#if canUseWebShare}
				<button class="btn btn-primary w-full" onclick={onShareClick}>
					<Share2Icon />
					<span>Share</span>
				</button>
			{/if}
			<!-- Download -->
			<button class="btn btn-primary w-full" onclick={onDownloadClick}>
				<FileDownIcon />
				<span>Download</span>
			</button>
		</div>
	</main>
</article>
