<script lang="ts">
	import { xact, selectionMetadata, postingEditorIndex } from '$lib/data/mainStore';
	import {
		ArrowDownIcon,
		ArrowUpIcon,
		CalculatorIcon,
		ChevronDownIcon,
		DiffIcon,
		PencilLineIcon,
		TrashIcon
	} from '@lucide/svelte';
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
	let expanded = $state(false);
	let isDeleteConfirmationOpen = $state(false);
	onMount(() => {});

	/**
	 * Open calculator to enter amount
	 */
	async function openCalculator() {
		// Set selection mode for amount calculation
		const meta = new SelectionModeMetadata();
		meta.postingIndex = index;
		meta.selectionType = 'amount';

		// Store the current amount value to initialize the calculator
		const currentAmount = $xact.postings[index].amount;
		if (currentAmount !== undefined && currentAmount !== null) {
			meta.initialValue = currentAmount;
		}

		selectionMetadata.set(meta);

		// Navigate to calculator
		await goto('/calculator');
	}

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

	/**
	 * Move this posting one place earlier in the list.
	 */
	function moveUp() {
		if (index === 0) return;
		xact.update((current) => {
			const postings = [...current.postings];
			[postings[index - 1], postings[index]] = [postings[index], postings[index - 1]];
			return { ...current, postings };
		});
	}

	/**
	 * Move this posting one place later in the list.
	 */
	function moveDown() {
		if (index === $xact.postings.length - 1) return;
		xact.update((current) => {
			const postings = [...current.postings];
			[postings[index], postings[index + 1]] = [postings[index + 1], postings[index]];
			return { ...current, postings };
		});
	}

	function onDeleteClicked() {
		isDeleteConfirmationOpen = true;
	}

	function onDeleteConfirmed() {
		isDeleteConfirmationOpen = false;
		xact.update((current) => ({
			...current,
			postings: current.postings.filter((_, i) => i !== index)
		}));
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

	<div class="mb-2 flex flex-row items-center gap-1">
		<button
			type="button"
			class="btn btn-outline btn-primary-content w-10 grow-0 rounded px-1"
			onclick={() => (expanded = !expanded)}
			title={expanded ? 'Hide posting actions' : 'Show posting actions'}
			aria-expanded={expanded}
		>
			<ChevronDownIcon class={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
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

	{#if expanded}
		<div class="mb-2 flex flex-row items-center justify-center gap-3">
			<button
				type="button"
				class="btn btn-outline btn-primary-content btn-square"
				onclick={openAdvancedEditor}
				title="Advanced posting editor"
			>
				<PencilLineIcon class="h-4 w-4" />
			</button>
			<button
				type="button"
				class="btn btn-outline btn-primary-content btn-square"
				onclick={changeSign}
				title="Flip amount sign"
			>
				<DiffIcon class="h-4 w-4" />
			</button>
			<button
				type="button"
				class="btn btn-outline btn-primary-content btn-square"
				onclick={openCalculator}
				title="Open calculator"
			>
				<CalculatorIcon class="h-4 w-4" />
			</button>
			<button
				type="button"
				class="btn btn-outline btn-primary-content btn-square"
				onclick={moveUp}
				disabled={index === 0}
				title="Move posting up"
			>
				<ArrowUpIcon class="h-4 w-4" />
			</button>
			<button
				type="button"
				class="btn btn-outline btn-primary-content btn-square"
				onclick={moveDown}
				disabled={index === $xact.postings.length - 1}
				title="Move posting down"
			>
				<ArrowDownIcon class="h-4 w-4" />
			</button>
			<button
				type="button"
				class="btn btn-outline btn-secondary btn-square"
				onclick={onDeleteClicked}
				title="Delete posting"
			>
				<TrashIcon class="h-4 w-4" />
			</button>
		</div>
	{/if}
</section>

<input type="checkbox" class="modal-toggle" bind:checked={isDeleteConfirmationOpen} />
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Confirm Delete</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">Do you want to delete this posting?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button
				type="button"
				class="btn btn-ghost rounded"
				onclick={() => (isDeleteConfirmationOpen = false)}>Cancel</button
			>
			<button type="button" class="btn btn-primary text-primary-content rounded" onclick={onDeleteConfirmed}
				>OK</button
			>
		</footer>
	</div>
</dialog>
