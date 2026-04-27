<script lang="ts">
	import { Account } from '$lib/data/model';
	import { formatAmount, getAmountColour } from '$lib/utils/formatter';
	import { getBarWidth } from '$lib/utils/barWidthCalculator';

	type Props = {
		account: Account;
		balancesLoaded: boolean;
		minBalance: number;
		maxBalance: number;
		onclick?: (name: string) => void;
	};
	let { account, balancesLoaded, minBalance, maxBalance, onclick }: Props = $props();

	const namespace = $derived(account.getParentName());
	const leafName = $derived(account.getAccountName());
	const isGrayed = $derived(account.exists === false);
	const quantity = $derived(account.balance?.quantity as number);

	const rowStyle = $derived.by(() => {
		if (!balancesLoaded) return '';
		const pct = getBarWidth(quantity, minBalance, maxBalance);
		if (pct === 0) return '';
		const color = quantity >= 0 ? '#22c55e' : '#f87171';
		return `background: linear-gradient(to right, ${color}20 ${pct}%, transparent ${pct}%)`;
	});
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class={`border-base-content/15 flex w-full flex-row border-b py-0.5 ${isGrayed ? 'text-base-content/50' : ''} ${onclick ? 'cursor-pointer' : ''}`}
	style={rowStyle}
	onclick={() => onclick?.(account.name)}
	role={onclick ? 'button' : undefined}
	tabindex={onclick ? 0 : undefined}
	onkeydown={(e) => e.key === 'Enter' && onclick?.(account.name)}
>
	<div class="mr-1 flex min-w-0 grow flex-col">
		{#if namespace}
			<small class="truncate leading-tight text-base-content/50">{namespace}</small>
		{/if}
		<span class={`text-base truncate ${namespace ? 'ml-2' : ''}`}>{leafName}</span>
	</div>
	<data
		class={`content-end ml-2 shrink-0 text-right tabular-nums ${balancesLoaded ? getAmountColour(quantity) : 'text-base-content/30'}`}
	>
		{#if balancesLoaded}
			{formatAmount(quantity)}
			{account.balance?.currency}
		{:else}
			···
		{/if}
	</data>
</div>
