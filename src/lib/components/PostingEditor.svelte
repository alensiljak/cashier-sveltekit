<script lang="ts">
	import { xact, postingEditorIndex } from '$lib/data/mainStore';
	import { DiffIcon, PencilLineIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import type { EventHandler } from 'svelte/elements';
	import { goto } from '$app/navigation';

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
	let isAdvanced = $derived(
		$xact?.postings[index]?.costAmount != null || $xact?.postings[index]?.priceAmount != null
	);
	let costPriceText = $derived.by(() => {
		const p = $xact?.postings[index];
		if (!p) return '';
		const parts: string[] = [];
		if (p.costAmount != null && p.costCurrency) {
			let costStr = `{${p.costAmount} ${p.costCurrency}`;
			if (p.costDate) costStr += `, ${p.costDate}`;
			costStr += '}';
			parts.push(costStr);
		}
		if (p.priceAmount != null && p.priceCurrency) {
			const op = p.totalPrice ? '@@' : '@';
			parts.push(`${op} ${p.priceAmount} ${p.priceCurrency}`);
		}
		return parts.join('    ');
	});
	onMount(() => {});

	let stripeClass = $derived(index % 2 === 0 ? 'bg-base-content/10' : '');

	async function openAdvancedEditor() {
		postingEditorIndex.set(index);
		await goto('/postings/editor');
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

<section class="w-full rounded px-2 py-2 {stripeClass}">
	<div class="relative mb-2 w-full">
		<input
			title="Account"
			placeholder=" "
			type="text"
			class="field-material peer w-full px-1 pt-4 pb-1 cursor-pointer"
			readonly
			bind:value={$xact.postings[index].account}
			onclick={onAccountClicked}
		/>
		<span class="field-label">Account</span>
	</div>

	<div class="flex flex-row items-end gap-1" class:mb-2={!isAdvanced}>
		<button
			type="button"
			class="btn btn-outline btn-primary-content btn-square"
			onclick={openAdvancedEditor}
			title="Advanced posting editor"
		>
			<PencilLineIcon class="h-4 w-4" />
		</button>
		<div class="relative grow">
			<input
				title="Amount"
				placeholder=" "
				type="number"
				class={`field-material peer w-full px-1 pt-4 pb-1 text-right text-lg ${amountFieldColor}`}
				bind:value={$xact.postings[index].amount}
				bind:this={amountInput}
				onfocus={() => amountInput.select()}
				oninput={onAmountChanged}
			/>
			<span class="field-label">Amount</span>
		</div>
		<button
			type="button"
			class="btn btn-outline btn-primary-content btn-square"
			onclick={changeSign}
			title="Flip amount sign"
		>
			<DiffIcon class="h-4 w-4" />
		</button>
		<div class="relative w-22">
			<input
				title="Currency"
				placeholder=" "
				type="text"
				class="field-material peer w-full px-1 pt-4 pb-1 text-center uppercase"
				bind:value={$xact.postings[index].currency}
				bind:this={currencyInput}
				onfocus={() => currencyInput.select()}
				oninput={() =>
					($xact.postings[index].currency = $xact.postings[index].currency?.toUpperCase())}
			/>
			<span class="field-label w-full text-center">Currency</span>
		</div>
	</div>

	{#if isAdvanced}
		<div class="mb-2 px-1 pt-1 font-mono text-xs opacity-60">{costPriceText}</div>
	{/if}
</section>
