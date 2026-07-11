<script lang="ts">
	import { Account } from '$lib/data/model';
	import { formatAmount } from '$lib/utils/formatter';
	import { RepeatIcon } from '@lucide/svelte';

	type Props = {
		account: string;
		amount: number;
		actual: number;
		currency: string;
		onAmountChange: (amount: number) => void;
		onclick?: (account: string) => void;
		// Rollover: surplus carried forward from earlier months this calendar
		// year, already clamped to zero-or-more. Only meaningful (and only
		// passed) in the monthly view — the annual view already sums the
		// whole year, so rollover would double-count.
		rolloverAmount?: number;
		rolloverEnabled?: boolean;
		onRolloverToggle?: (enabled: boolean) => void;
	};
	let {
		account,
		amount,
		actual,
		currency,
		onAmountChange,
		onclick,
		rolloverAmount = 0,
		rolloverEnabled = false,
		onRolloverToggle
	}: Props = $props();

	const acct = $derived(new Account(account));
	const namespace = $derived(acct.getParentName());
	const leafName = $derived(acct.getAccountName());

	// The bar/colour/percent compare actuals against budget + any carried
	// rollover; the editable field below always shows the base amount.
	const effectiveBudget = $derived(amount + rolloverAmount);

	// Percentage of budget consumed, capped at 100 for the bar width; unbounded for the label.
	const percent = $derived.by(() => {
		if (effectiveBudget <= 0) return actual > 0 ? 100 : 0;
		return Math.min(100, Math.round((actual / effectiveBudget) * 100));
	});
	const percentExact = $derived(effectiveBudget > 0 ? Math.round((actual / effectiveBudget) * 100) : null);

	const progressColour = $derived.by(() => {
		if (effectiveBudget <= 0) return actual > 0 ? 'progress-error' : 'progress-neutral';
		if (actual > effectiveBudget) return 'progress-error';
		if (actual >= effectiveBudget * 0.8) return 'progress-warning';
		return 'progress-success';
	});

	function onInput(e: Event) {
		const value = parseFloat((e.target as HTMLInputElement).value);
		onAmountChange(isNaN(value) ? 0 : value);
	}

	function stopClick(e: Event) {
		e.stopPropagation();
	}

	function onRolloverClick(e: Event) {
		e.stopPropagation();
		onRolloverToggle?.(!rolloverEnabled);
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
			{#if onRolloverToggle}
			<button
					type="button"
					class="btn btn-xs px-1.5 {rolloverEnabled ? 'btn-primary' : 'btn-ghost border border-base-content/25 text-base-content/50'}"
					title={rolloverEnabled ? 'Rollover on: unspent budget carries into next month' : 'Turn on rollover'}
					aria-pressed={rolloverEnabled}
					aria-label="Toggle rollover"
					onclick={onRolloverClick}
				>
					<RepeatIcon size={14} />
				</button>
			{/if}
			<span class="text-sm tabular-nums {actual > effectiveBudget && effectiveBudget > 0 ? 'text-error' : 'text-base-content/70'}">
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
	{#if rolloverEnabled && rolloverAmount > 0}
		<div class="-mt-1 text-right text-xs text-primary/70">
			+{formatAmount(rolloverAmount)} carried
		</div>
	{/if}
	<div class="flex items-center gap-2">
		<progress class="progress {progressColour} h-2 w-full" value={percent} max="100"></progress>
		{#if percentExact !== null}
			<span class="w-10 shrink-0 text-right text-xs text-base-content/50">{percentExact}%</span>
		{/if}
	</div>
</div>
