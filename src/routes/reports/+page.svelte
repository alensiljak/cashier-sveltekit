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
		ScaleIcon,
		ActivityIcon,
		LineChartIcon,
		PercentIcon
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
			<SquareButton
				Icon={TerminalIcon}
				classes="bg-accent text-secondary"
				onclick={() => goto('/reports/query')}
			>
				Queries
			</SquareButton>
			<SquareButton
				Icon={ReceiptIcon}
				classes="bg-secondary text-accent"
				onclick={() => goto('/reports/expenses')}
			>
				Expenses
			</SquareButton>
			<SquareButton
				Icon={ScaleIcon}
				classes="bg-primary text-accent"
				onclick={() => goto('/reports/balance-sheet')}
			>
				Balance Sheet
			</SquareButton>
			<SquareButton
				Icon={ArrowLeftRightIcon}
				classes="bg-primary text-accent"
				onclick={() => goto('/reports/income-statement')}
			>
				Income Statement
			</SquareButton>
			<SquareButton
				Icon={TrendingUpIcon}
				classes="bg-primary text-accent"
				onclick={() => goto('/reports/net-worth')}
			>
				Net Worth
			</SquareButton>
			<SquareButton
				Icon={LineChartIcon}
				classes="bg-primary text-accent"
				onclick={() => goto('/reports/cost-vs-market')}
			>
				Cost v. Market
			</SquareButton>
			<SquareButton
				Icon={LandmarkIcon}
				classes="bg-primary text-accent"
				onclick={() => goto('/reports/trial-balance')}
			>
				Trial Balance
			</SquareButton>
			<SquareButton
				Icon={ActivityIcon}
				classes="bg-primary text-accent"
				onclick={() => goto('/reports/running-balance')}
			>
				Running Balance
			</SquareButton>
			<SquareButton
				Icon={PercentIcon}
				classes="bg-primary text-accent"
				onclick={() => goto('/reports/portfolio-returns')}
			>
				Portfolio Returns
			</SquareButton>
		</div>
	</div>
</main>
