<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="About"></Toolbar>

	<section class="overflow-auto p-1">
		<p>
			Cashier Svelte is a version of <a class="anchor" href="cashier.alensiljak.eu.org">Cashier</a>, built with
			Svelte.
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
			To achieve its full purpose, Cashier is synchronized with Ledger data. It allows exporting the
			created transactions. For a proper start, it should be populated with the data from Ledger,
			using Cashier Server, <a class="anchor" href="https://github.com/alensiljak/cashier-server-rust">repo</a>.
		</p>
	</section>
</article>
