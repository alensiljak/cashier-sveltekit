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
		($xact?.postings[index].amount as number) < 0 ? 'bg-secondary-500/20!' : 'bg-primary-500/20!'
	);

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

<section>
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
		<div>
			<button
				type="button"
				class="preset-outlined-surface-500 btn border-tertiary-200/50 w-12 grow-0 rounded-sm border px-1"
				onclick={changeSign}
			>
				<DiffIcon />
			</button>
		</div>
		<input
			title="Amount"
			placeholder="Amount"
			type="number"
			class={`input variant-form-material grow text-right ${amountFieldColor} px-1`}
			bind:value={$xact.postings[index].amount}
			bind:this={amountInput}
			onfocus={() => amountInput.select()}
			oninput={onAmountChanged}
		/>
		<!--
		class={$xact.postings[index].amount as number >= 0 ? 'bg-primary-500/20!' : 'bg-secondary-500/20!'}
		oninput={() => updateAmount($xact.postings[index].amount as number)}
		onchange={onAmountChanged}
	-->
		<div class="min-w-24 shrink">
			<input
				title="Currency"
				placeholder="Currency"
				type="text"
				class="input variant-form-material px-1 text-center"
				bind:value={$xact.postings[index].currency}
			/>
		</div>
		<!--
		oninput={() => updateCurrency($xact.postings[index].currency)}
		uppercase
	-->
	</div>
</section>
