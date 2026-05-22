<script lang="ts">
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { xact, postingEditorIndex } from '$lib/data/mainStore';
	import { CheckIcon } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	onMount(() => {
		if (!$xact) {
			goto('/');
		}
	});

	let index = $derived($postingEditorIndex);
	let posting = $derived($xact?.postings[index]);

	function onFab() {
		history.back();
	}

	function clearPrice() {
		if (!posting) return;
		$xact.postings[index].priceAmount = undefined;
		$xact.postings[index].priceCurrency = undefined;
		$xact.postings[index].totalPrice = undefined;
	}

	function clearCost() {
		if (!posting) return;
		$xact.postings[index].costAmount = undefined;
		$xact.postings[index].costCurrency = undefined;
		$xact.postings[index].costDate = undefined;
	}

	let previewText = $derived.by(() => {
		if (!posting) return '';
		const parts: string[] = [];
		if (posting.account) parts.push(posting.account);
		if (posting.amount != null) {
			parts.push(`${posting.amount} ${posting.currency ?? ''}`);
		}
		if (posting.costAmount != null && posting.costCurrency) {
			let costStr = `{${posting.costAmount} ${posting.costCurrency}`;
			if (posting.costDate) costStr += `, ${posting.costDate}`;
			costStr += '}';
			parts.push(costStr);
		}
		if (posting.priceAmount != null && posting.priceCurrency) {
			const op = posting.totalPrice ? '@@' : '@';
			parts.push(`${op} ${posting.priceAmount} ${posting.priceCurrency}`);
		}
		return parts.join('  ');
	});
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Posting Editor" />
	<Fab Icon={CheckIcon} onclick={onFab} />

	{#if posting}
		<section class="container mx-auto flex-1 overflow-y-auto touch-pan-y px-4 py-4 space-y-5 lg:max-w-screen-sm">
			<!-- Preview -->
			{#if previewText}
				<div class="bg-base-200 rounded px-3 py-2 font-mono text-sm break-all">
					{previewText}
				</div>
			{/if}

			<!-- Account -->
			<div class="form-control">
				<label class="label" for="account">
					<span class="label-text font-semibold">Account</span>
				</label>
				<input
					id="account"
					type="text"
					placeholder="Account"
					class="input w-full rounded"
					bind:value={$xact.postings[index].account}
				/>
			</div>

			<!-- Amount + Currency -->
			<div class="form-control">
				<label class="label" for="amount">
					<span class="label-text font-semibold">Amount</span>
				</label>
				<div class="flex gap-2">
					<input
						id="amount"
						type="number"
						placeholder="Amount"
						class="input flex-1 rounded text-right"
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
			</div>

			<!-- Cost annotation: {amount currency[, date]} -->
			<div class="form-control">
				<label class="label">
					<span class="label-text font-semibold">Cost <span class="font-mono text-xs opacity-60">{'{'}amount CCY[, date]{'}'}</span></span>
					{#if posting.costAmount != null}
						<button type="button" class="label-text-alt btn btn-xs btn-ghost" onclick={clearCost}>Clear</button>
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
				<label class="label">
					<span class="label-text font-semibold">Price <span class="font-mono text-xs opacity-60">@ / @@ amount CCY</span></span>
					{#if posting.priceAmount != null}
						<button type="button" class="label-text-alt btn btn-xs btn-ghost" onclick={clearPrice}>Clear</button>
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
		</section>
	{/if}
</article>
