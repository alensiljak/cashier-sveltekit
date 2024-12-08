<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { xact } from '$lib/data/mainStore';
	import Notifier from '$lib/utils/notifier';
	import { parseXact } from '$lib/utils/transactionParser';
	import { ImportIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';

    Notifier.init()

	let inputText = $state('');
    let inputControl: HTMLTextAreaElement;

    onMount(() => {
        inputControl.focus()
    })

	async function onImportClicked() {
		try {
			await importXact()
		} catch (error) {
			Notifier.error((error as Error).message)
		}
	}

	async function importXact() {
		if(!inputText) {
            Notifier.warn('Paste a transaction record into the input field first')
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

<article class="flex h-screen flex-col">
	<Toolbar title="Import Ledger item"></Toolbar>

	<section class="h-full p-1 flex flex-col space-y-3">
		<p>Paste a Ledger transaction record below to import it.</p>

		<textarea class="textarea grow" bind:value={inputText} bind:this={inputControl}></textarea>

		<center class="py-6">
			<button type="button" class="variant-filled-primary btn" onclick={onImportClicked}>
				<span><ImportIcon /></span>
				<span>Import</span>
			</button>
		</center>
	</section>
</article>
