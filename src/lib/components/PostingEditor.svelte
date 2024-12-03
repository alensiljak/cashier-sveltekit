<script lang="ts">
	import { xact } from '$lib/data/mainStore';
	import { DiffIcon } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import type { EventHandler } from 'svelte/elements';

	type Props = {
		index: number;
		// posting?: Posting;
		onAccountClicked?: EventHandler;
		onAmountChanged?: () => void;
	};
	let {
		index,
		// posting = $bindable(),
		onAccountClicked,
		onAmountChanged
	}: Props = $props();

	let amountInput: HTMLInputElement;

	onMount(() => {
		// bind to the Posting from the store.
		// posting = $xact.postings[index]
		// console.log(posting)
	});

	/**
	 * Change amount sign.
	 */
	function changeSign() {
		let amount = $xact.postings[index].amount || 0;
		$xact.postings[index].amount = amount * -1;

		if (onAmountChanged) {
			onAmountChanged();
		}
	}

	function updateAmount(value: number) {
		console.debug('update amount', value);
		$xact.postings[index].amount = value;
	}

	function updateCurrency(value: string) {
		$xact.postings[index].currency = value;
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
		<button type="button" class="variant-outline-surface btn" onclick={changeSign}>
			<DiffIcon />
		</button>
	</div>

	<input
		title="Amount"
		placeholder="Amount"
		type="number"
		class="w=2/4 input variant-form-material text-right bg-red-500"
		bind:value={$xact.postings[index].amount}
		bind:this={amountInput}
		onfocus={() => amountInput.select()}
		oninput={onAmountChanged}
		class:bg-green-500={$xact.postings[index].amount as number >= 0} 
  		class:negative={$xact.postings[index].amount as number < 0} 
	/>
	<!--
		oninput={() => updateAmount($xact.postings[index].amount as number)}
		onchange={onAmountChanged}
	-->
	<input
		title="Currency"
		placeholder="Currency"
		type="text"
		class="input variant-form-material w-1/4 text-center"
		bind:value={$xact.postings[index].currency}
	/>
	<!--
		oninput={() => updateCurrency($xact.postings[index].currency)}
		uppercase
	-->
</div>
