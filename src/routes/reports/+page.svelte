<script lang="ts">
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import SquareButton from '$lib/components/SquareButton.svelte';
	import {
		TerminalIcon,
		SearchIcon,
		LandmarkIcon,
		TrendingUpIcon,
		ReceiptIcon,
		ArrowLeftRightIcon,
		ScaleIcon
	} from '@lucide/svelte';
</script>

<main>
	<Toolbar title="Reports">
		{#snippet actions()}
			<HelpButton topic="reports" />
		{/snippet}
	</Toolbar>

	<div class="flex-1 overflow-y-auto touch-pan-y px-1">
		<div class="mx-auto grid w-350 max-w-[350px] grid-cols-3 pt-3">
			<SquareButton Icon={TerminalIcon} classes="bg-accent text-secondary" onclick={() => goto('/reports/query')}>
				Queries
			</SquareButton>
			<SquareButton Icon={SearchIcon} classes="bg-accent text-secondary" onclick={() => goto('/reports/tx-search')}>
				Search
			</SquareButton>
			<SquareButton Icon={LandmarkIcon} classes="bg-primary text-accent" onclick={() => goto('/reports/assets')}>
				Assets
			</SquareButton>
			<SquareButton Icon={ScaleIcon} classes="bg-primary text-accent" onclick={() => goto('/reports/balance-sheet')}>
				Balance Sheet
			</SquareButton>
			<SquareButton Icon={TrendingUpIcon} classes="bg-primary text-accent" onclick={() => goto('/reports/net-worth')}>
				Net Worth
			</SquareButton>
			<SquareButton Icon={ReceiptIcon} classes="bg-secondary text-accent" onclick={() => goto('/reports/expenses')}>
				Expenses
			</SquareButton>
			<SquareButton Icon={ArrowLeftRightIcon} classes="bg-primary text-accent" onclick={() => goto('/reports/income-expense')}>
				Income / Expenses
			</SquareButton>
		</div>
	</div>
</main>
