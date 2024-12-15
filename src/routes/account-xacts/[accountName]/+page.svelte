<script lang="ts">
	import { page } from '$app/stores';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { Posting } from '$lib/data/model';
    import * as Formatter from '$lib/utils/formatter'

</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Account Transactions"></Toolbar>
	<section class="h-full overflow-auto p-1 space-y-2">
		<header>
			<p>{$page.data.account.getParentName()}</p>
			<div class="flex flex-row">
				<data class="h2 grow">
					{$page.data.account.getAccountName()}
				</data>
				<data class={`h3 ${Formatter.getAmountColour($page.data.total.quantity)}`}>
					{Formatter.formatAmount($page.data.total.quantity)}
					{$page.data.total.currency}
				</data>
			</div>
		</header>

		<hr class="hr" />

		<div class="space-y-1">
			{#each $page.data.xacts as xact}
				{@const posting = xact.postings?.find(
					(p: Posting) => p.account === $page.data.account.name
				)}

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
