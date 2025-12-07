<script lang="ts">
	import type { Xact } from '$lib/data/model';
	import { getAmountColour } from '$lib/utils/formatter';

	interface Props {
		xact: Xact;
		onclick?: (xact: Xact) => void;
	}
	let { xact, onclick }: Props = $props();

	function onRowClicked() {
		if (onclick) {
			onclick(xact);
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article onclick={onRowClicked}>
	<!-- date/payee -->
	<div class="flex flex-row space-x-2">
		<time class="opacity-60">
			{xact.date}
			<!-- todo: ISO format -->
		</time>
		<div>
			{xact.payee}
		</div>
	</div>

	<!-- note -->
	{#if xact.note}
		<div class="text-primary pl-6 leading-4">
			<small>; {xact.note}</small>
		</div>
	{/if}

	<!-- postings -->
	{#if xact.postings}
		<div class="pl-6 text-base leading-4">
			{#each xact.postings as posting (posting)}
				<div class="flex flex-row opacity-60">
					<data class="grow">{posting.account}</data>
					<data class={`${getAmountColour(posting.amount as number)}`}>
						{posting.amount} {posting.currency}</data
					>
				</div>
			{/each}
		</div>
	{/if}
</article>
