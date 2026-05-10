<script lang="ts">
	import { formatAmount, getAmountColour } from '$lib/utils/formatter';

	type Props = {
		balances: Record<string, number> | undefined;
		defaultCurrency: string;
		loaded: boolean;
		class?: string;
	};
	let { balances, defaultCurrency, loaded, class: className = '' }: Props = $props();

	const primaryCurrency = $derived(
		balances && defaultCurrency && defaultCurrency in balances
			? defaultCurrency
			: balances
				? (Object.keys(balances)[0] ?? '')
				: ''
	);
	const primaryQuantity = $derived(balances?.[primaryCurrency] ?? 0);
	const extraBalances = $derived(
		balances
			? Object.entries(balances).filter(([cur]) => cur !== primaryCurrency)
			: []
	);
	const hasMultiple = $derived(extraBalances.length > 0);

	let expanded = $state(false);

	function toggle(e: MouseEvent | KeyboardEvent) {
		e.stopPropagation();
		expanded = !expanded;
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class={`flex flex-col items-end tabular-nums ${className}`}>
	<data
		class={`text-right ${loaded ? getAmountColour(primaryQuantity) : 'text-base-content/30'} ${hasMultiple && loaded ? 'cursor-pointer' : ''}`}
		role={hasMultiple && loaded ? 'button' : undefined}
		tabindex={hasMultiple && loaded ? 0 : undefined}
		onclick={hasMultiple && loaded ? toggle : undefined}
		onkeydown={hasMultiple && loaded ? (e) => e.key === 'Enter' && toggle(e) : undefined}
	>
		{#if loaded}
			{formatAmount(primaryQuantity)}&nbsp;{primaryCurrency}{#if hasMultiple}<span class="text-base-content/40"> …</span>{/if}
		{:else}
			···
		{/if}
	</data>

	{#if expanded && loaded}
		{#each extraBalances as [currency, amount]}
			<data class={`text-right ${getAmountColour(amount)}`}>
				{formatAmount(amount)}&nbsp;{currency}
			</data>
		{/each}
	{/if}
</div>
