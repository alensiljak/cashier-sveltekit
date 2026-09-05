<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { xact, selectionMetadata, postingEditorIndex } from '$lib/data/mainStore';
	import { CalculatorIcon, CheckIcon, DiffIcon, ListIcon, TrashIcon, XIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { SelectionModeMetadata } from '$lib/settings';
	import { getAccountBalance, loadAccount } from '$lib/services/accountsService';
	import appService from '$lib/services/appService';

	onMount(async () => {
		if (!$xact) {
			goto('/');
			return;
		}

		if (
			$selectionMetadata?.selectionType === 'amount' &&
			typeof $selectionMetadata.selectedId === 'number' &&
			typeof $selectionMetadata.postingIndex === 'number'
		) {
			const amount = $selectionMetadata.selectedId;
			const postingIndex = $selectionMetadata.postingIndex;
			if ($xact.postings[postingIndex]) {
				$xact.postings[postingIndex].amount = amount;
			}
			selectionMetadata.set(undefined);
		}

		if (
			$selectionMetadata?.selectionType === 'account' &&
			$selectionMetadata.selectedId &&
			typeof $selectionMetadata.postingIndex === 'number'
		) {
			const accountName = $selectionMetadata.selectedId as string;
			const postingIndex = $selectionMetadata.postingIndex;
			selectionMetadata.set(undefined);

			if ($xact.postings[postingIndex]) {
				const defaultCurrency = await appService.getDefaultCurrency();
				const account = await loadAccount(accountName);
				const acctBalance = getAccountBalance(account, defaultCurrency);

				$xact.postings[postingIndex].account = account.name;
				$xact.postings[postingIndex].currency = acctBalance.currency;
			}
		}
	});

	let index = $derived($postingEditorIndex);
	let posting = $derived($xact?.postings[index]);
	let amountFieldColor = $derived(
		($xact?.postings[index]?.amount as number) < 0 ? 'bg-secondary/20' : 'bg-primary/20'
	);
	let isDeleteConfirmationOpen = $state(false);
	let isOverwriteConfirmationOpen = $state(false);

	function onFab() {
		history.back();
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
		history.back();
	}

	function onSelectAccountClicked() {
		if ($xact.postings[index]?.account) {
			isOverwriteConfirmationOpen = true;
		} else {
			navigateToAccountSelection();
		}
	}

	function onOverwriteConfirmed() {
		isOverwriteConfirmationOpen = false;
		navigateToAccountSelection();
	}

	async function navigateToAccountSelection() {
		const meta = new SelectionModeMetadata();
		meta.postingIndex = index;
		meta.selectionType = 'account';
		selectionMetadata.set(meta);

		await goto('/accounts');
	}

	function clearPrice() {
		if (!posting) return;
		$xact.postings[index].priceAmount = undefined;
		$xact.postings[index].priceCurrency = undefined;
		$xact.postings[index].totalPrice = undefined;
	}

	function changeSign() {
		if (!posting) return;
		const amount = $xact.postings[index].amount || 0;
		$xact.postings[index].amount = amount * -1;
	}

	/**
	 * Open calculator to enter amount
	 */
	async function openCalculator() {
		const meta = new SelectionModeMetadata();
		meta.postingIndex = index;
		meta.selectionType = 'amount';

		const currentAmount = $xact.postings[index].amount;
		if (currentAmount !== undefined && currentAmount !== null) {
			meta.initialValue = currentAmount;
		}

		selectionMetadata.set(meta);

		await goto('/calculator');
	}

	function clearCost() {
		if (!posting) return;
		$xact.postings[index].costAmount = undefined;
		$xact.postings[index].costCurrency = undefined;
		$xact.postings[index].costDate = undefined;
	}

	let previewText = $derived.by(() => {
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
		return parts.join('    ');
	});
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Posting Editor" />
	<Fab Icon={CheckIcon} onclick={onFab} />

	{#if posting}
		<section class="container mx-auto flex-1 overflow-y-auto touch-pan-y px-4 py-4 space-y-5 lg:max-w-screen-sm">
			<!-- Preview -->
			{#if previewText}
				<div class="bg-base-200 rounded px-3 py-2 font-mono text-sm break-all whitespace-pre-wrap">
					{previewText}
				</div>
			{/if}

			<!-- Account -->
			<div class="form-control">
				<label class="label" for="account">
					<span class="label-text font-semibold">Account</span>
				</label>
				<div class="flex gap-2">
					<input
						id="account"
						type="text"
						placeholder="Account"
						class="input flex-1 rounded"
						bind:value={$xact.postings[index].account}
					/>
					<button
						type="button"
						class="btn btn-outline btn-primary-content btn-square"
						onclick={onSelectAccountClicked}
						title="Select account"
					>
						<ListIcon class="h-4 w-4" />
					</button>
				</div>
			</div>

			<!-- Amount + Currency -->
			<div class="form-control">
				<label class="label" for="amount">
					<span class="label-text font-semibold">Amount</span>
				</label>
				<div class="flex gap-2">
					<button
						type="button"
						class="btn btn-outline btn-primary-content btn-square"
						onclick={changeSign}
						title="Flip amount sign"
					>
						<DiffIcon class="h-4 w-4" />
					</button>
					<input
						id="amount"
						type="number"
						placeholder="Amount"
						class={`input flex-1 rounded text-right ${amountFieldColor}`}
						bind:value={$xact.postings[index].amount}
					/>
					<input
						type="text"
						placeholder="CCY"
						class="input w-24 rounded text-center uppercase"
						bind:value={$xact.postings[index].currency}
						oninput={() => ($xact.postings[index].currency = $xact.postings[index].currency?.toUpperCase())}
					/>
				</div>
				<div class="mt-2">
					<button
						type="button"
						class="btn btn-outline btn-primary-content"
						onclick={openCalculator}
						title="Open calculator"
					>
						<CalculatorIcon class="h-4 w-4" />
						Calculator
					</button>
				</div>
			</div>

			<!-- Cost annotation: {amount currency[, date]} -->
			<div class="form-control">
				<label class="label flex w-full items-center justify-between">
					<span class="label-text font-semibold">Cost <span class="font-mono text-xs opacity-60">{'{'}amount CCY[, date]{'}'}</span></span>
					{#if $xact.postings[index]?.costAmount != null}
						<button type="button" class="label-text-alt btn btn-sm btn-error" onclick={clearCost}>
							<XIcon class="h-4 w-4" />
							Clear
						</button>
					{/if}
				</label>
				<div class="flex gap-2">
					<input
						type="number"
						placeholder="Cost amount"
						class="input flex-1 rounded text-right"
						bind:value={$xact.postings[index].costAmount}
					/>
					<input
						type="text"
						placeholder="CCY"
						class="input w-24 rounded text-center uppercase"
						bind:value={$xact.postings[index].costCurrency}
						oninput={() => ($xact.postings[index].costCurrency = $xact.postings[index].costCurrency?.toUpperCase())}
					/>
				</div>
				<div class="mt-2">
					<input
						type="date"
						title="Cost date"
						class="input w-full rounded"
						bind:value={$xact.postings[index].costDate}
					/>
				</div>
			</div>

			<!-- Price annotation: @ or @@ amount currency -->
			<div class="form-control">
				<label class="label flex w-full items-center justify-between">
					<span class="label-text font-semibold">Price <span class="font-mono text-xs opacity-60">@ / @@ amount CCY</span></span>
					{#if $xact.postings[index]?.priceAmount != null}
						<button type="button" class="label-text-alt btn btn-sm btn-error" onclick={clearPrice}>
							<XIcon class="h-4 w-4" />
							Clear
						</button>
					{/if}
				</label>
				<div class="flex gap-2 mb-2">
					<div class="join">
						<button
							type="button"
							class="join-item btn btn-sm"
							class:btn-primary={!$xact.postings[index].totalPrice}
							class:btn-outline={!!$xact.postings[index].totalPrice}
							onclick={() => ($xact.postings[index].totalPrice = false)}
						>@</button>
						<button
							type="button"
							class="join-item btn btn-sm"
							class:btn-primary={!!$xact.postings[index].totalPrice}
							class:btn-outline={!$xact.postings[index].totalPrice}
							onclick={() => ($xact.postings[index].totalPrice = true)}
						>@@</button>
					</div>
				</div>
				<div class="flex gap-2">
					<input
						type="number"
						placeholder="Price amount"
						class="input flex-1 rounded text-right"
						bind:value={$xact.postings[index].priceAmount}
					/>
					<input
						type="text"
						placeholder="CCY"
						class="input w-24 rounded text-center uppercase"
						bind:value={$xact.postings[index].priceCurrency}
						oninput={() => ($xact.postings[index].priceCurrency = $xact.postings[index].priceCurrency?.toUpperCase())}
					/>
				</div>
			</div>

			<div class="flex justify-center pt-2">
				<button
					type="button"
					class="btn btn-outline btn-secondary"
					onclick={onDeleteClicked}
					title="Delete posting"
				>
					<TrashIcon class="h-4 w-4" />
					Delete posting
				</button>
			</div>
		</section>
	{/if}
</main>

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

<input type="checkbox" class="modal-toggle" bind:checked={isOverwriteConfirmationOpen} />
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Replace Account</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">This posting already has an account set. Selecting a new one will overwrite it. Continue?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button
				type="button"
				class="btn btn-ghost rounded"
				onclick={() => (isOverwriteConfirmationOpen = false)}>Cancel</button
			>
			<button type="button" class="btn btn-primary text-primary-content rounded" onclick={onOverwriteConfirmed}
				>OK</button
			>
		</footer>
	</div>
</dialog>
