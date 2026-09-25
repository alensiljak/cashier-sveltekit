<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { xact } from '$lib/data/mainStore';
	import Notifier from '$lib/utils/notifier';
	import { parseXact } from '$lib/utils/transactionParser';
	import { getXactStore } from '$lib/storage/xactStoreRegistry';
	import { locateXactsInSource } from '$lib/utils/xactLocator';
	import { readFile } from '$lib/utils/opfslib';
	import { CASHIER_XACT_FILE } from '$lib/constants';
	import { DatabaseIcon, FileDownIcon, ImportIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';

	Notifier.init();

	const NL = '\n';

	let inputText = $state('');
	let inputControl: HTMLTextAreaElement | undefined = undefined;

	onMount(() => {
		inputControl?.focus();
	});

	async function onImportClicked() {
		try {
			await importXact();
		} catch (error) {
			Notifier.error((error as Error).message);
		}
	}

	async function onLoadFromFileClicked() {
		try {
			const text = await readFile(CASHIER_XACT_FILE);
			if (!text) {
				Notifier.info(`${CASHIER_XACT_FILE} is empty or missing in OPFS`);
				return;
			}
			inputText = text;
		} catch (error) {
			Notifier.error((error as Error).message);
		}
	}

	/** Add every transaction in the input to the active store. */
	async function onImportAllClicked() {
		try {
			if (!inputText.trim()) {
				Notifier.info('Paste transactions or load them from the file first');
				return;
			}
			const locations = await locateXactsInSource(inputText);
			if (locations.length === 0) {
				Notifier.info('No transactions found in the input');
				return;
			}
			const lines = inputText.split(NL);
			const store = await getXactStore();
			for (const { span } of locations) {
				await store.append(lines.slice(span.startLine, span.endLine + 1).join(NL));
			}
			Notifier.success(`Imported ${locations.length} transaction(s) into the ${store.kind} store`);
		} catch (error) {
			Notifier.error((error as Error).message);
		}
	}

	async function importXact() {
		if (!inputText) {
			Notifier.info('Paste a transaction record into the input field first');
			return;
		}

		// parse the transaction
		let x = parseXact(inputText);
		// set to store
		xact.set(x);
		// show the editor for any modifications
		goto('/tx', { replaceState: true });
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Import Ledger item"></Toolbar>

	<section class="flex h-full flex-col space-y-3 p-1">
		<p>Paste transaction records below, or load them from the OPFS file. "Import one" opens the first in the editor; "Import all to store" adds every record to the active store.</p>

		<textarea class="textarea w-full grow" bind:value={inputText} bind:this={inputControl}></textarea>

		<div class="flex flex-wrap justify-center gap-2 py-6">
			<button type="button" class="btn" onclick={onLoadFromFileClicked}>
				<span><FileDownIcon /></span>
				<span>Load {CASHIER_XACT_FILE}</span>
			</button>
			<button type="button" class="btn btn-primary" onclick={onImportClicked}>
				<span><ImportIcon /></span>
				<span>Import one</span>
			</button>
			<button type="button" class="btn btn-secondary" onclick={onImportAllClicked}>
				<span><DatabaseIcon /></span>
				<span>Import all to store</span>
			</button>
		</div>
	</section>
</main>
