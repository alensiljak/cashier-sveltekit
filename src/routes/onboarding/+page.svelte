<script lang="ts">
	import { goto } from '$app/navigation';
	import appService from '#lib/services/appService';
	import demoDataService from '#lib/services/demoDataService';
	import { finishInitialization } from '#lib/data/initializer';
	import Notifier from '#lib/utils/notifier';

	let busy = $state(false);

	async function chooseDemo() {
		busy = true;
		try {
			await appService.initializeXactStore();
			await demoDataService.activateDemoData();
			await finishInitialization();
			await goto('/');
		} catch (err) {
			Notifier.error('Failed to load demo data: ' + err);
			busy = false;
		}
	}

	/** Initializes empty stores, then opens `target`. */
	async function startEmpty(target: string) {
		busy = true;
		try {
			await appService.initializeXactStore();
			await finishInitialization();
			await goto(target);
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

		<button
			class="btn btn-outline mt-2"
			onclick={() => startEmpty('/opfs/import-ledger')}
			disabled={busy}
		>
			Import my ledger
		</button>
		<p class="px-1 text-xs opacity-60">Bring in your own Beancount files.</p>

		<button
			class="btn btn-outline mt-2"
			onclick={() => startEmpty('/sync/backup-file')}
			disabled={busy}
		>
			Restore from backup
		</button>
		<p class="px-1 text-xs opacity-60">
			Bring back your data and settings from a Cashier backup file.
		</p>

		<button class="btn btn-ghost mt-2" onclick={() => startEmpty('/')} disabled={busy}>
			Start empty
		</button>
		<p class="px-1 text-xs opacity-60">Begin with a blank book and add your own accounts.</p>
	</div>
</main>
