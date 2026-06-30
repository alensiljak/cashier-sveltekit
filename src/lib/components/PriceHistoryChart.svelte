<!--
  PriceHistoryChart — line area chart showing price history for a commodity.
  Timespan buttons (1d, 5d, 1m, 6m, 1y, 5y) filter the data client-side for
  instant response.  All data is loaded once from the in-memory WASM ledger.
-->
<script lang="ts">
	import {
		LineController,
		LineElement,
		PointElement,
		CategoryScale,
		LinearScale,
		Chart,
		Tooltip,
		Filler
	} from 'chart.js';

	export interface PricePoint {
		/** YYYY-MM-DD */
		date: string;
		price: number;
		priceCurrency: string;
	}

	interface Props {
		points: PricePoint[];
		/** The price currency label shown in the tooltip, e.g. "USD" */
		priceCurrency: string;
	}

	let { points, priceCurrency }: Props = $props();

	Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Filler);

	const SPANS: { label: string; days: number | null }[] = [
		{ label: '1d', days: 1 },
		{ label: '5d', days: 7 },
		{ label: '1m', days: 30 },
		{ label: '3m', days: 90 },
		{ label: '6m', days: 180 },
		{ label: '1y', days: 365 },
		{ label: '5y', days: 1825 },
		{ label: 'All', days: null }
	];

	// Default to "1y"; all data is loaded so switching is instant.
	let selectedSpanIdx = $state(5);

	const filtered = $derived.by((): PricePoint[] => {
		if (points.length === 0) return [];
		const { days } = SPANS[selectedSpanIdx];
		if (days === null) return points;
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - days);
		const cutoffStr = cutoff.toISOString().slice(0, 10);
		return points.filter((p) => p.date >= cutoffStr);
	});

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: Chart | null = null;

	$effect(() => {
		const pts = $state.snapshot(filtered) as PricePoint[];

		if (chart) {
			chart.destroy();
			chart = null;
		}
		if (!canvas || pts.length === 0) return;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const labels = pts.map((p) => p.date);
		const values = pts.map((p) => p.price);

		// Create a gradient fill from the top of the chart downward.
		const gradient = ctx.createLinearGradient(0, 0, 0, 220);
		gradient.addColorStop(0, 'rgba(99,179,237,0.35)');
		gradient.addColorStop(1, 'rgba(99,179,237,0.02)');

		chart = new Chart(ctx, {
			type: 'line',
			data: {
				labels,
				datasets: [
					{
						data: values,
						borderColor: 'rgba(99,179,237,1)',
						backgroundColor: gradient,
						borderWidth: 1.5,
						// Hide points when there are many — keeps the chart readable.
						pointRadius: pts.length > 60 ? 0 : 3,
						pointHoverRadius: 4,
						tension: 0.1,
						fill: true
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: {
					intersect: false,
					mode: 'index'
				},
				plugins: {
					legend: { display: false },
					tooltip: {
						callbacks: {
							label: (c) => ` ${Number(c.raw).toFixed(4)} ${priceCurrency}`
						}
					}
				},
				scales: {
					x: {
						ticks: {
							maxTicksLimit: 6,
							maxRotation: 0,
							font: { size: 11 }
						},
						grid: { display: false }
					},
					y: {
						position: 'right',
						ticks: {
							font: { size: 11 },
							callback: (v) => Number(v).toFixed(2)
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

<!-- Timespan selector -->
<div class="flex justify-end gap-1 mb-2 px-1">
	{#each SPANS as span, i (span.label)}
		<button
			class="btn btn-xs {i === selectedSpanIdx ? 'btn-primary' : 'btn-ghost opacity-50'}"
			onclick={() => (selectedSpanIdx = i)}
		>
			{span.label}
		</button>
	{/each}
</div>

<!-- Chart area -->
<div class="relative w-full" style="height: 220px">
	{#if filtered.length === 0}
		<div class="flex h-full items-center justify-center opacity-40 text-sm">
			No price data for this period
		</div>
	{:else}
		<canvas bind:this={canvas}></canvas>
	{/if}
</div>
