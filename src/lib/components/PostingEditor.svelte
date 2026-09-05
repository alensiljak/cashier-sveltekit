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
	let summaryText = $derived.by(() => {
		const p = $xact?.postings[index];
		if (!p) return '';
		const parts: string[] = [];
		if (p.account) parts.push(p.account);
		if (p.amount != null) {
			parts.push(`${p.amount} ${p.currency ?? ''}`);
		}
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

<section class="w-full">
	{#if isAdvanced}
		<div class="mb-2 flex flex-row items-center gap-2 rounded border border-base-300 p-2">
			<div class="flex-1 font-mono text-sm break-all whitespace-pre-wrap">{summaryText}</div>
			<button
				type="button"
				class="btn btn-primary btn-square shrink-0"
				onclick={openAdvancedEditor}
				title="Edit posting"
			>
				<PencilLineIcon class="h-4 w-4" />
			</button>
		</div>
	{:else}
		<input
			title="Account"
			placeholder="Account"
			type="text"
			class="input w-full rounded"
			readonly
			bind:value={$xact.postings[index].account}
			onclick={onAccountClicked}
		/>

		<div class="mb-2 flex flex-row items-center gap-1">
			<button
				type="button"
				class="btn btn-outline btn-primary-content btn-square"
				onclick={openAdvancedEditor}
				title="Advanced posting editor"
			>
				<PencilLineIcon class="h-4 w-4" />
			</button>
			<input
				title="Amount"
				placeholder="Amount"
				type="number"
				class={`input grow text-right text-lg ${amountFieldColor} rounded`}
				bind:value={$xact.postings[index].amount}
				bind:this={amountInput}
				onfocus={() => amountInput.select()}
				oninput={onAmountChanged}
			/>
			<button
				type="button"
				class="btn btn-outline btn-primary-content btn-square"
				onclick={changeSign}
				title="Flip amount sign"
			>
				<DiffIcon class="h-4 w-4" />
			</button>
			<input
				title="Currency"
				placeholder="Currency"
				type="text"
				class="input rounded text-center uppercase w-22 p-1"
				bind:value={$xact.postings[index].currency}
				bind:this={currencyInput}
				onfocus={() => currencyInput.select()}
				oninput={() =>
					($xact.postings[index].currency = $xact.postings[index].currency?.toUpperCase())}
			/>
		</div>
	{/if}
</section>
