<script lang="ts">
	import { goto } from '$app/navigation';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import SquareButton from '#lib/components/SquareButton.svelte';
	import SquareButtonGroup from '#lib/components/SquareButtonGroup.svelte';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import LandmarkIcon from '@lucide/svelte/icons/landmark';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
	import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
	import ScaleIcon from '@lucide/svelte/icons/scale';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import ChartLineIcon from '@lucide/svelte/icons/chart-line';
	import PercentIcon from '@lucide/svelte/icons/percent';
	import ChartColumnStackedIcon from '@lucide/svelte/icons/chart-column-stacked';
	import FileSpreadsheetIcon from '@lucide/svelte/icons/file-spreadsheet';
</script>

<main>
	<Toolbar title="Reports">
		{#snippet actions()}
			<HelpButton topic="reports" />
		{/snippet}
	</Toolbar>

	<div class="flex-1 overflow-y-auto touch-pan-y px-1">
		<SquareButtonGroup>
			<SquareButton
				Icon={TerminalIcon}
				classes="bg-accent text-secondary"
				onclick={() => goto('/reports/query')}
			>
				Queries
			</SquareButton>
			<SquareButton
				Icon={ChartColumnStackedIcon}
				classes="bg-secondary text-accent"
				onclick={() => goto('/reports/expense-trend')}
			>
				Expense Trend
			</SquareButton>
			<SquareButton
				Icon={ReceiptIcon}
				classes="bg-secondary text-accent"
				onclick={() => goto('/reports/expenses')}
			>
				Expense Categories
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
				Icon={ChartLineIcon}
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
			<SquareButton
				Icon={FileSpreadsheetIcon}
				classes="bg-primary text-accent"
				onclick={() => goto('/reports/tax-summary')}
			>
				Tax Summary
			</SquareButton>
		</SquareButtonGroup>
	</div>
</main>
