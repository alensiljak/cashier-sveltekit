<!--
  ExpensesDonutChart - donut chart showing expense proportions per account.
  Slices are colored by hue rotation across the palette. Click a slice to drill down.
-->
<script lang="ts">
	import { DoughnutController, ArcElement, Tooltip, Chart } from 'chart.js';

	interface Props {
		labels: string[];
		values: number[];
		height?: string;
		onclick?: (account: string) => void;
	}

	let { labels, values, height = '24rem', onclick }: Props = $props();

	Chart.register(DoughnutController, ArcElement, Tooltip);

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: Chart | null = null;

	function makeColors(n: number): string[] {
		return Array.from({ length: n }, (_, i) =>
			`hsla(${Math.round((i * 360) / n)}, 65%, 55%, 0.85)`
		);
	}

	$effect(() => {
		const plainLabels: string[] = $state.snapshot(labels) as string[];
		const plainValues: number[] = $state.snapshot(values) as number[];

		if (chart) {
			chart.destroy();
			chart = null;
		}
		if (!canvas || plainLabels.length === 0) return;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const colors = makeColors(plainLabels.length);
		const total = plainValues.reduce((s, v) => s + v, 0);

		chart = new Chart(ctx, {
			type: 'doughnut',
			data: {
				labels: plainLabels,
				datasets: [
					{
						data: plainValues,
						backgroundColor: colors,
						borderColor: 'transparent',
						borderWidth: 0
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				onClick: onclick
					? (_event, elements) => {
							if (elements.length > 0) {
								const index = elements[0].index;
								if (index >= 0 && index < plainLabels.length) onclick(plainLabels[index]);
							}
						}
					: undefined,
				plugins: {
					legend: { display: false },
					tooltip: {
						callbacks: {
							label: (ctx) => {
								const val = Number(ctx.raw).toFixed(2);
								const pct = total > 0 ? ((Number(ctx.raw) / total) * 100).toFixed(1) : '0';
								return ` ${val} (${pct}%)`;
							}
						}
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

	<div class="relative" class:cursor-pointer={!!onclick} style="height: {height}">
	<canvas bind:this={canvas}></canvas>
</div>
