<script>
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { xact } from '$lib/data/mainStore';
	import appService from '$lib/services/appService';
	import { ImportIcon } from 'lucide-svelte';

	async function onImportClicked() {
        // parse the transaction
        

        // set to store
        // $xact = 

        // show the editor for any modifications
        goto('/tx')
    }
</script>

<Toolbar title="Import Ledger item"></Toolbar>
<section>
	<p>Paste a Ledger transaction record below to import it.</p>

	<textarea></textarea>

	<center>
		<button type="button" class="btn variant-filled-primary" onclick={onImportClicked}>
            <span><ImportIcon /></span>
            <span>Import</span>
        </button>
	</center>
</section>
