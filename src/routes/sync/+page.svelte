<script>
	import Toolbar from '$lib/components/toolbar.svelte';
	import { RefreshCcw } from 'lucide-svelte';
	import { onMount } from 'svelte';

	let serverUrl = 'http://localhost:3000';

	onMount(async () => {
		// todo: load sync settings
	});
</script>

<Toolbar title="Cashier Sync" />

<main class="container space-y-4 p-1 lg:p-10">
	<p>To update data from Ledger, the Cashier Server must be running and accessible.</p>
	<p>You can run the Cashier Server locally.</p>

	<label class="label">
		<span>Server URL</span>
		<input class="input" type="text" placeholder="Server URL" bind:value={serverUrl} />
	</label>

	<div class="flex flex-col space-y-8 pt-6">
		<label class="flex items-center space-x-2">
			<input class="checkbox" type="checkbox" />
			<p>Sync account list with balances</p>
		</label>
		<label class="flex items-center space-x-2">
			<input class="checkbox" type="checkbox" />
			<p>Sync account balances in base currency, for asset allocation.</p>
		</label>
		<label class="flex items-center space-x-2">
			<input class="checkbox" type="checkbox" />
			<p>Sync Payees</p>
		</label>
	</div>

    <center class="pt-10">
        <button class="btn bg-tertiary-500 uppercase text-secondary-500">
            <span><RefreshCcw /></span>
            <span>Sync</span>
        </button>
    </center>
</main>
