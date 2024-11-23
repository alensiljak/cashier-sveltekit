<script lang="ts">
	import { xact } from '$lib/data/mainStore';
	import type { Posting } from '$lib/data/model';
	import { onMount } from 'svelte';
	import type { EventHandler } from 'svelte/elements';

	type Props = {
		index: number;
		// posting?: Posting;
		onAccountClicked?: EventHandler;
		onAmountChanged?: EventHandler;
	};
	let {
		index,
		// posting = $bindable(),
		onAccountClicked,
		onAmountChanged
	}: Props = $props();

	let posting: Posting = $state($xact.postings[index]);

	onMount(() => {
		// bind to the Posting from the store.
		// posting = $xact.postings[index]
		// console.log(posting)
	});
</script>

<input
	title="Account"
	placeholder="Account"
	type="text"
	class="input"
	readonly
	bind:value={posting.account}
	onclick={onAccountClicked}
/>

<div class="flex flex-row">
	<!-- amount sign -->
	<div class="w-1/4 text-center">
		<button class="variant-outline-surface btn">+/-</button>
	</div>

	<input
		title="Amount"
		placeholder="Amount"
		type="number"
		class="w=2/4 input text-right"
		bind:value={posting.amount}
		onchange={onAmountChanged}
	/>
	<input
		title="Currency"
		placeholder="Currency"
		type="text"
		class="input w-1/4 text-center uppercase"
		bind:value={posting.currency}
	/>
</div>
