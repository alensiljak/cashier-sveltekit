<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import rustledger from '$lib/services/rustledger';
	import { useRegisterSW } from 'virtual:pwa-register/svelte';
	import { RefreshCw } from '@lucide/svelte';

	let wasmVersion = '';
	let checking = false;
	let updateChecked = false;
	let registration: ServiceWorkerRegistration | undefined;

	const { needRefresh, updateServiceWorker } = useRegisterSW({
		onRegistered(r) {
			registration = r;
		}
	});

	onMount(async () => {
		try {
			await rustledger.ensureInitialized();
			wasmVersion = rustledger.version();
		} catch {
			wasmVersion = 'unavailable';
		}
	});

	async function checkForUpdates() {
		checking = true;
		updateChecked = false;
		try {
			await registration?.update();
		} finally {
			checking = false;
			updateChecked = true;
		}
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="About"></Toolbar>

	<section class="space-y-4 p-1">
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
			Build: <code>{__BUILD_TIMESTAMP__}</code>
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
		{#if updateChecked && !$needRefresh}
			<p>You are on the latest version.</p>
		{/if}
		{#if $needRefresh}
			<p>A new version is available.</p>
			<button class="btn btn-sm btn-primary" onclick={() => updateServiceWorker(true)}>Update</button>
		{/if}

		<h3 class="text-3xl font-semibold">Experiments</h3>

		<ul>
			<li>
				<a class="link link-primary" href="/demo/rledger">RustLedger demo</a>
			</li>
			<li>
				<a class="link link-primary" href="/ledger">Parsed Ledger</a>
			</li>
			<li>
				<a class="link link-primary" href="/ledger/multi">Parsed Multi Ledger</a>
			</li>
		</ul>
	</section>
</article>
