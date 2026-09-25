<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import rustledger from '$lib/services/rustledger';
	import { checkForUpdate } from '$lib/services/pwaUpdate';
	import Notifier from '$lib/utils/notifier';
	import { MicIcon, RefreshCw } from '@lucide/svelte';

	let wasmVersion = $state('');
	let buildTimestamp = $state('fetching…');
	let checking = $state(false);

	onMount(async () => {
		loadBuildTimestamp();
		try {
			await rustledger.ensureInitialized();
			wasmVersion = rustledger.version();
		} catch {
			wasmVersion = 'unavailable';
		}
	});

	// build-info.json is emitted at build time (see vite.config.ts) and precached by the service worker.
	async function loadBuildTimestamp() {
		try {
			const response = await fetch('/build-info.json');
			buildTimestamp = (await response.json()).buildTimestamp;
		} catch {
			buildTimestamp = 'unavailable';
		}
	}

	async function checkForUpdates() {
		checking = true;
		try {
			const result = await checkForUpdate();
			switch (result) {
				case 'latest':
					Notifier.success('You are on the latest version.');
					break;
				case 'available':
					Notifier.info('Update available. Use the prompt to update.');
					break;
				case 'unavailable':
					Notifier.warning('Updates are not available (no service worker registered).');
					break;
				case 'error':
					Notifier.error('Could not check for updates. Are you online?');
					break;
			}
		} finally {
			checking = false;
		}
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="About"></Toolbar>

	<section class="space-y-4 p-1 mx-auto max-w-2xl w-full">
		<h1 class="text-5xl font-bold">Cashier Svelte</h1>
		<p>
			Cashier Svelte is a version of
			<a class="link link-primary" href="https://cashier.alensiljak.eu.org">Cashier</a>,
			built with Svelte.
		</p>

		<p>
			Cashier is a pocket helper for Plain-Text Accounting (PTA) systems, like Ledger CLI, Hledger,
			or Beancount. More on PTA at
			<a class="link link-primary" href="https://plaintextaccounting.org/">Plain Text Accounting</a>.
		</p>

		<p>
			It is used to write transaction records and transfer them to the full-blown personal finance
			system. It can also display the account and other useful information. For more detailed
			overview of the functionality, see the
			<a class="link link-primary" href="/help">Help</a> section.
		</p>

		<p>
			Cashier can also read your whole Beancount ledger. Use Ledger Import function to copy
			and regularly update your ledger data. Eventually export the Journal transactions created on your
			device and store them into your ledger files.
		</p>

		<h3 class="text-3xl font-semibold">Links</h3>
		<p>
			Repository: at
			<a class="link link-primary" href="https://github.com/alensiljak/cashier-svelte">GitHub</a>
		</p>

		<h3 class="text-3xl font-semibold">Version</h3>
		<p>
			Build: <code>{buildTimestamp}</code>
		</p>
		<p>
			RustLedger WASM: <code>{wasmVersion || 'loading…'}</code>
		</p>
		<p>
			<button class="link link-primary inline-flex items-center gap-1" onclick={checkForUpdates} disabled={checking}>
				<RefreshCw size={14} class={checking ? 'animate-spin' : ''} />
				{checking ? 'Checking…' : 'Check for updates'}
			</button>
		</p>

		<h3 class="text-3xl font-semibold">Experiments</h3>

		<ul>
			<li>
				<a class="link" href="/demo/rledger">RustLedger demo</a>
			</li>
			<li>
				<a class="link" href="/ledger">Parsed Ledger</a>
			</li>
			<li>
				<a class="link" href="/ledger/multi">Parsed Multi Ledger</a>
			</li>
			<li>
				<a class="link" href="/ledger/journal">Full Journal</a>
			</li>
			<li>
				<a class="link inline-flex items-center gap-1" href="/tools/voice-entry">
					<MicIcon size={16} /> Voice Entry
				</a>
			</li>
		</ul>
	</section>
</main>
