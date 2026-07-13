<!--
  CostVsMarketChart - two-line chart comparing cost basis vs. market value
  of investment holdings per month (base currency). Months on the X-axis.
-->
<script lang="ts">
	import {
		CategoryScale,
		Chart,
		Filler,
		LinearScale,
		LineController,
		LineElement,
		PointElement,
		Tooltip
	} from 'chart.js';

	interface Props {
		months: string[];
		costBasis: number[];
		marketValue: number[];
	}

	let { months, costBasis, marketValue }: Props = $props();

	Chart.register(
		CategoryScale,
		LinearScale,
		LineController,
		LineElement,
		PointElement,
		Filler,
		Tooltip
	);

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: Chart | null = null;

	$effect(() => {
		const plainMonths: string[] = $state.snapshot(months) as string[];
		const plainCostBasis: number[] = $state.snapshot(costBasis) as number[];
		const plainMarketValue: number[] = $state.snapshot(marketValue) as number[];

		if (chart) {
			chart.destroy();
			chart = null;
		}
		if (!canvas || plainMonths.length === 0) return;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		chart = new Chart(ctx, {
			type: 'line',
			data: {
				labels: plainMonths,
				datasets: [
					{
						label: 'Market value',
						data: plainMarketValue,
						borderColor: 'rgba(34, 197, 94, 1)',
						backgroundColor: 'rgba(34, 197, 94, 0.15)',
						fill: '+1',
						tension: 0.15,
						pointRadius: 2
					},
					{
						label: 'Cost basis',
						data: plainCostBasis,
						borderColor: 'rgba(107, 114, 128, 1)',
						backgroundColor: 'rgba(107, 114, 128, 0.1)',
						borderDash: [5, 3],
						fill: false,
						tension: 0.15,
						pointRadius: 2
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: { mode: 'index', intersect: false },
				plugins: {
					legend: { display: true, position: 'top', labels: { font: { size: 11 } } },
					tooltip: {
						callbacks: {
							label: (c) => ` ${c.dataset.label}: ${Number(c.raw).toFixed(2)}`
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
