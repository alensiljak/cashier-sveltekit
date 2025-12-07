<script lang="ts">
	import { xact, selectionMetadata } from '$lib/data/mainStore';
	import { DiffIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import type { EventHandler } from 'svelte/elements';
	import { goto } from '$app/navigation';
	import { SelectionModeMetadata } from '$lib/settings';

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

	onMount(() => {});

	/**
	 * Open calculator to enter amount
	 */
	async function onAmountClicked() {
		// Set selection mode for amount calculation
		const meta = new SelectionModeMetadata();
		meta.postingIndex = index;
		meta.selectionType = 'amount';
		selectionMetadata.set(meta);

		// Navigate to calculator
		await goto('/calculator');
	}

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

	<div class="mb-2 flex flex-row items-center">
		<!-- amount sign -->
		<div>
			<button
				type="button"
				class="btn btn-outline btn-primary-content w-12 grow-0 rounded px-1"
				onclick={changeSign}
			>
				<DiffIcon />
			</button>
		</div>
		<input
			title="Amount"
			placeholder="Amount"
			type="number"
			class={`input grow text-right text-lg ${amountFieldColor} rounded`}
			bind:value={$xact.postings[index].amount}
			bind:this={amountInput}
			onfocus={() => amountInput.select()}
			oninput={onAmountChanged}
			onclick={onAmountClicked}
		/>
		<input
			title="Currency"
			placeholder="Currency"
			type="text"
			class="input rounded text-center text-lg uppercase w-24"
			bind:value={$xact.postings[index].currency}
			bind:this={currencyInput}
			onfocus={() => currencyInput.select()}
			oninput={() =>
				($xact.postings[index].currency = $xact.postings[index].currency?.toUpperCase())}
		/>
	</div>
</section>
