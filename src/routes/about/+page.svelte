<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="About"></Toolbar>

	<section class="space-y-4 overflow-auto p-1">
		<h1 class="h1">Cashier Svelte</h1>
		<p>
			Cashier Svelte is a version of <a class="anchor" href="https://cashier.alensiljak.eu.org">Cashier</a>,
			built with Svelte.
		</p>

		<p>
			Cashier is a pocket helper for Plain-Text Accounting (PTA) systems, like Ledger CLI, Hledger,
			or Beancount. More on PTA at
			<a class="anchor" href="https://plaintextaccounting.org/">Plain Text Accounting</a>.
		</p>

		<p>
			It is used to write transaction records and transfer them to the full-blown personal finance
			system. It can also display the account and other useful information. For more detailed
			overview of the functionality, see the <a class="anchor" href="/help">Help</a> section.
		</p>

		<p>
			To achieve its full purpose, Cashier is synchronized with Ledger-cli data. It allows exporting
			the created transactions. For a proper start, it should be populated with the data from
			Ledger, using Cashier Server, <a class="anchor"
				href="https://github.com/alensiljak/cashier-server-python">repo</a>.
			Install the server with <code>uv tool install cashier-server</code>.
		</p>

		<h3 class="h3">Links</h3>
		<p>
			Repository: at <a class="anchor" href="https://github.com/alensiljak/cashier-svelte">GitHub</a>
		</p>

		<h3 class="h3">Version</h3>
		<p>
			Build Date: <code>{__BUILD_DATE__}</code>
		</p>
	</section>
</article>
