<script lang="ts">
	import { page } from '$app/state';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { Posting, Xact } from '$lib/data/model';
	import * as Formatter from '$lib/utils/formatter';
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Account Transactions"></Toolbar>
	<section class="h-full space-y-2 overflow-auto p-1">
		<header>
			<p>{page.data.account.getParentName()}</p>
			<div class="flex flex-row text-3xl font-bold">
				<data class="grow">
					{page.data.account.getAccountName()}
				</data>
				<data class={`${Formatter.getAmountColour(page.data.total.quantity)}`}>
					{Formatter.formatAmount(page.data.total.quantity)}
					{page.data.total.currency}
				</data>
			</div>
		</header>

		<hr class="hr text-gray-600" />

		<div class="space-y-1">
			{#each page.data.xacts as xact: Xact (xact)}
				{@const posting = xact.postings?.find((p: Posting) => p.account === page.data.account.name)}

				<div class="flex flex-row px-2">
					<data class="grow">
						{xact.payee}
					</data>
					<data class={`${Formatter.getAmountColour(posting?.amount)}`}>
						{Formatter.formatAmount(posting?.amount)}
						{posting?.currency}
					</data>
				</div>
			{/each}
		</div>
	</section>
</article>
