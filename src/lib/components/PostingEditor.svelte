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

	// let posting: Posting = $state($xact.postings[index]);
	let account = $state($xact.postings[index].account)
	let amount = $state($xact.postings[index].amount)
	let currency = $state($xact.postings[index].currency)

	onMount(() => {
		// bind to the Posting from the store.
		// posting = $xact.postings[index]
		// console.log(posting)
	});

	function updateAmount(value: number) {
		$xact.postings[index].amount = value
	}

	function updateCurrency(value: string) {
		$xact.postings[index].currency = value
	}
</script>

<input
	title="Account"
	placeholder="Account"
	type="text"
	class="input"
	readonly
	bind:value={$xact.postings[index].account}
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
		bind:value={amount}
		oninput={() => updateAmount(amount as number)}
		onchange={onAmountChanged}
	/>
	<input
		title="Currency"
		placeholder="Currency"
		type="text"
		class="input w-1/4 text-center uppercase"
		bind:value={currency}
		oninput={() => updateCurrency(currency)}
	/>
</div>
