<script lang="ts">
	import { goto } from '$app/navigation';
	import appService from '$lib/services/appService';
	import demoDataService from '$lib/services/demoDataService';
	import { finishInitialization } from '$lib/data/initializer';
	import Notifier from '$lib/utils/notifier';

	let busy = $state(false);

	async function chooseDemo() {
		busy = true;
		try {
			await appService.createDefaultCashierFile();
			await demoDataService.activateDemoData();
			await finishInitialization();
			await goto('/');
		} catch (err) {
			Notifier.error('Failed to load demo data: ' + err);
			busy = false;
		}
	}

	async function chooseImport() {
		busy = true;
		try {
			await appService.createDefaultCashierFile();
			await finishInitialization();
			await goto('/opfs/import-ledger');
		} catch (err) {
			Notifier.error('Failed to initialize: ' + err);
			busy = false;
		}
	}

	async function chooseEmpty() {
		busy = true;
		try {
			await appService.createDefaultCashierFile();
			await finishInitialization();
			await goto('/');
		} catch (err) {
			Notifier.error('Failed to initialize: ' + err);
			busy = false;
		}
	}
</script>

<main class="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 p-6">
	<div class="text-center">
		<h1 class="text-2xl font-bold">Welcome to Cashier</h1>
		<p class="mt-2 text-sm opacity-70">How would you like to get started?</p>
	</div>

	<div class="flex flex-col gap-3">
		<button class="btn btn-primary" onclick={chooseDemo} disabled={busy}> Try demo data </button>
		<p class="px-1 text-xs opacity-60">
			Explore Cashier with a sample book — accounts, transactions, and an asset allocation target
			already set up.
		</p>

		<button class="btn btn-outline mt-2" onclick={chooseImport} disabled={busy}>
			Import my ledger
		</button>
		<p class="px-1 text-xs opacity-60">Bring in your own Beancount files.</p>

		<button class="btn btn-ghost mt-2" onclick={chooseEmpty} disabled={busy}> Start empty </button>
		<p class="px-1 text-xs opacity-60">Begin with a blank book and add your own accounts.</p>
	</div>
</main>
