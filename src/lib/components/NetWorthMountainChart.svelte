<!--
  NetWorthMountainChart — area/mountain line chart for net worth over time.
  Green fill for positive final value, red for negative. Smooth curve.
-->
<script lang="ts">
	import {
		Chart,
		LineController,
		LineElement,
		PointElement,
		CategoryScale,
		LinearScale,
		Filler,
		Tooltip
	} from 'chart.js';

	interface Props {
		months: string[];
		netWorth: number[];
		/** Currency label shown in tooltip suffix */
		currency?: string;
	}

	let { months, netWorth, currency = '' }: Props = $props();

	Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Filler, Tooltip);

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: Chart | null = null;

	$effect(() => {
		const plainMonths = $state.snapshot(months) as string[];
		const plainValues = $state.snapshot(netWorth) as number[];

		chart?.destroy();
		chart = null;

		if (!canvas || plainMonths.length === 0) return;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const isPositive = plainValues[plainValues.length - 1] >= 0;
		const baseColor = isPositive ? '34, 197, 94' : '239, 68, 68';

		// Vertical gradient: solid at top, transparent at baseline.
		const grad = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
		grad.addColorStop(0, `rgba(${baseColor}, 0.5)`);
		grad.addColorStop(1, `rgba(${baseColor}, 0.02)`);

		chart = new Chart(ctx, {
			type: 'line',
			data: {
				labels: plainMonths,
				datasets: [
					{
						label: 'Net Worth',
						data: plainValues,
						borderColor: `rgba(${baseColor}, 1)`,
						borderWidth: 2,
						pointRadius: plainMonths.length > 24 ? 0 : 3,
						pointHoverRadius: 5,
						tension: 0.35,
						fill: true,
						backgroundColor: grad
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
							label: (c) => ` ${Number(c.raw).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ' ' + currency : ''}`
						}
					}
				},
				scales: {
					x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
					y: {
						beginAtZero: false,
						ticks: { font: { size: 10 } }
					}
				}
			}
		});

		return () => {
			chart?.destroy();
			chart = null;
		};
	});
</script>

<div class="relative w-full" style="height: 12rem">
	<canvas bind:this={canvas}></canvas>
</div>
