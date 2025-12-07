<script lang="ts">
	import { xact } from '$lib/data/mainStore';
	import { DiffIcon } from '@lucide/svelte';
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
	let amountFieldColor = $derived(
		($xact?.postings[index].amount as number) < 0 ? 'bg-secondary/20' : 'bg-primary/20'
	);
	let currencyInput: HTMLInputElement;

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
		// console.debug('update amount', value);
		$xact.postings[index].amount = value;
	}

	function updateCurrency(value: string) {
		$xact.postings[index].currency = value;
	}
</script>

<section class="w-full">
	<input
		title="Account"
		placeholder="Account"
		type="text"
		class="input w-full rounded"
		readonly
		bind:value={$xact.postings[index].account}
		onclick={onAccountClicked}
	/>

	<div class="flex flex-row mb-2">
		<!-- amount sign -->
		<div>
			<button
				type="button"
				class="btn btn-outline btn-primary-content w-12 grow-0 px-1 rounded"
				onclick={changeSign}
			>
				<DiffIcon />
			</button>
		</div>
		<input
			title="Amount"
			placeholder="Amount"
			type="number"
			class={`input grow text-lg text-right ${amountFieldColor} px-1 rounded`}
			bind:value={$xact.postings[index].amount}
			bind:this={amountInput}
			onfocus={() => amountInput.select()}
			oninput={onAmountChanged}
		/>
		<!--
		class={$xact.postings[index].amount as number >= 0 ? 'bg-primary bg-opacity-20!' : 'bg-secondary bg-opacity-20!'}
		oninput={() => updateAmount($xact.postings[index].amount as number)}
		onchange={onAmountChanged}
		-->
		<div class="min-w-24 shrink">
			<input
				title="Currency"
				placeholder="Currency"
				type="text"
				class="input text-lg px-1 text-center rounded"
				bind:value={$xact.postings[index].currency}
				bind:this={currencyInput}
				onfocus={() => currencyInput.select()}
			/>
		</div>
		<!--
		oninput={() => updateCurrency($xact.postings[index].currency)}
		uppercase
	-->
	</div>
</section>
