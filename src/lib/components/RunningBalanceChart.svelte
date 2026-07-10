<!--
  RunningBalanceChart - vertical bar chart of account balance per month (base currency).
  Months on the X-axis, balance on the Y-axis. Green bars for positive, red for negative.
-->
<script lang="ts">
	import {
		BarController,
		BarElement,
		CategoryScale,
		LinearScale,
		Chart,
		Tooltip
	} from 'chart.js';

	interface Props {
		months: string[];
		balances: number[];
		currency: string;
	}

	let { months, balances, currency }: Props = $props();

	Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: Chart | null = null;

	$effect(() => {
		const plainMonths: string[] = $state.snapshot(months) as string[];
		const plainBalances: number[] = $state.snapshot(balances) as number[];

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
						label: `Balance (${currency})`,
						data: plainBalances,
						backgroundColor: plainBalances.map((v) =>
							v >= 0 ? 'rgba(34, 197, 94, 0.75)' : 'rgba(239, 68, 68, 0.75)'
						),
						borderColor: plainBalances.map((v) =>
							v >= 0 ? 'rgba(34, 197, 94, 1)' : 'rgba(239, 68, 68, 1)'
						),
						borderWidth: 1
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: { display: false },
					tooltip: {
						callbacks: {
							label: (c) => ` ${Number(c.raw).toFixed(2)}`
						}
					}
				},
				scales: {
					x: { ticks: { font: { size: 11 } } },
					y: { beginAtZero: false }
				}
			}
		});

		return () => {
			chart?.destroy();
			chart = null;
		};
	});
</script>

<div class="relative w-full" style="height: 20rem">
	<canvas bind:this={canvas}></canvas>
</div>
