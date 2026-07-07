<script lang="ts">
	import { Account } from '$lib/data/model';
	import { formatAmount } from '$lib/utils/formatter';

	type Props = {
		account: string;
		amount: number;
		actual: number;
		currency: string;
		onAmountChange: (amount: number) => void;
		onclick?: (account: string) => void;
	};
	let { account, amount, actual, currency, onAmountChange, onclick }: Props = $props();

	const acct = $derived(new Account(account));
	const namespace = $derived(acct.getParentName());
	const leafName = $derived(acct.getAccountName());

	// Percentage of budget consumed, capped at 100 for the bar width; unbounded for the label.
	const percent = $derived.by(() => {
		if (amount <= 0) return actual > 0 ? 100 : 0;
		return Math.min(100, Math.round((actual / amount) * 100));
	});
	const percentExact = $derived(amount > 0 ? Math.round((actual / amount) * 100) : null);

	const progressColour = $derived.by(() => {
		if (amount <= 0) return actual > 0 ? 'progress-error' : 'progress-neutral';
		if (actual > amount) return 'progress-error';
		if (actual >= amount * 0.8) return 'progress-warning';
		return 'progress-success';
	});

	function onInput(e: Event) {
		const value = parseFloat((e.target as HTMLInputElement).value);
		onAmountChange(isNaN(value) ? 0 : value);
	}

	function stopClick(e: Event) {
		e.stopPropagation();
	}
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="border-base-content/15 flex flex-col gap-1 border-b px-1 py-2 {onclick ? 'cursor-pointer' : ''}"
	onclick={() => onclick?.(account)}
	role={onclick ? 'button' : undefined}
	tabindex={onclick ? 0 : undefined}
	onkeydown={(e) => e.key === 'Enter' && onclick?.(account)}
>
	<div class="flex items-start justify-between gap-2">
		<div class="min-w-0 flex-1">
			{#if namespace}
				<small class="block truncate leading-tight text-base-content/50">{namespace}</small>
			{/if}
			<span class="truncate">{leafName}</span>
		</div>
		<div class="flex shrink-0 items-center gap-1">
			<span class="text-sm tabular-nums {actual > amount && amount > 0 ? 'text-error' : 'text-base-content/70'}">
				{formatAmount(actual)}
			</span>
			<span class="text-sm text-base-content/40">/</span>
			<input
				type="number"
				inputmode="decimal"
				step="0.01"
				class="input input-sm input-bordered w-24 text-right tabular-nums"
				value={amount}
				onclick={stopClick}
				onkeydown={stopClick}
				onchange={onInput}
			/>
			<span class="text-sm text-base-content/50">{currency}</span>
		</div>
	</div>
	<div class="flex items-center gap-2">
		<progress class="progress {progressColour} h-2 w-full" value={percent} max="100"></progress>
		{#if percentExact !== null}
			<span class="w-10 shrink-0 text-right text-xs text-base-content/50">{percentExact}%</span>
		{/if}
	</div>
</div>
