<!--
  IncomeExpenseChart - horizontal grouped bar chart (months on Y-axis) showing income vs expenses.
  Optimized for phone screens. Green bars for income, red bars for expenses.
-->
<script lang="ts">
	import {
		BarController,
		BarElement,
		CategoryScale,
		LinearScale,
		Chart,
		Tooltip,
		Legend
	} from 'chart.js';

	interface Props {
		months: string[];
		income: number[];
		expenses: number[];
	}

	let { months, income, expenses }: Props = $props();

	Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: Chart | null = null;

	$effect(() => {
		const plainMonths: string[] = $state.snapshot(months) as string[];
		const plainIncome: number[] = $state.snapshot(income) as number[];
		const plainExpenses: number[] = $state.snapshot(expenses) as number[];

		if (chart) {
			chart.destroy();
			chart = null;
		}
		if (!canvas || plainMonths.length === 0) return;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		chart = new Chart(ctx, {
			type: 'bar',
			data: {
				labels: plainMonths,
				datasets: [
					{
						label: 'Income',
						data: plainIncome,
						backgroundColor: 'rgba(34, 197, 94, 0.75)',
						borderColor: 'rgba(34, 197, 94, 1)',
						borderWidth: 1
					},
					{
						label: 'Expenses',
						data: plainExpenses,
						backgroundColor: 'rgba(239, 68, 68, 0.75)',
						borderColor: 'rgba(239, 68, 68, 1)',
						borderWidth: 1
					}
				]
			},
			options: {
				indexAxis: 'y',
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: { display: true, position: 'top' },
					tooltip: {
						callbacks: {
							label: (c) => ` ${c.dataset.label}: ${Number(c.raw).toFixed(2)}`
						}
					}
				},
				scales: {
					y: { ticks: { font: { size: 11 } } },
					x: { beginAtZero: true }
				}
			}
		});

		return () => {
			chart?.destroy();
			chart = null;
		};
	});
</script>

<div class="relative w-full" style="height: calc({months.length} * 44px + 80px)">
	<canvas bind:this={canvas}></canvas>
</div>
