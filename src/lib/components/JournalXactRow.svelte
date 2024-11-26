<script lang="ts">
	import type { Xact } from '$lib/data/model';
	import type { EventHandler } from 'svelte/elements';

	interface Props {
		xact: Xact;
        onclick?: EventHandler
	}
	let { xact, onclick }: Props = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article onclick={onclick}>
	<!-- date/payee -->
	<div class="flex flex-row space-x-2">
		<div>
			{xact.date}
			<!-- todo: ISO format -->
		</div>
		<div>
			{xact.payee}
		</div>
	</div>

	<!-- note -->
	{#if xact.note}
		<div class="pl-6 leading-4 text-primary-500">
			<small>; {xact.note}</small>
		</div>
	{/if}

	<!-- postings -->
	{#if xact.postings}
		<div class="pl-6 leading-4 text-sm">
			{#each xact.postings as posting}
				<div class="flex flex-row">
					<div class="grow">{posting.account}</div>
					<div>{posting.amount} {posting.currency}</div>
				</div>
			{/each}
		</div>
	{/if}
</article>
