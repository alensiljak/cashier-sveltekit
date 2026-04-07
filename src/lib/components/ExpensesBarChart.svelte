<!--
  ExpensesBarChart - horizontal bar chart for expense amounts per account.
  Bars are red; account names appear on the y-axis. Sorted by the caller (desc).
-->
<script lang="ts">
	import { BarController, BarElement, CategoryScale, LinearScale, Chart, Tooltip } from 'chart.js';

	interface Props {
		/** Account names (already sorted desc by amount) */
		labels: string[];
		/** Amounts matching each label */
		values: number[];
		/** Called when a bar is clicked, with the account name */
		onclick?: (account: string) => void;
	}

	let { labels, values, onclick }: Props = $props();

	Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: Chart | null = null;

	$effect(() => {
		// Snapshot the $state proxy arrays into plain arrays before handing to Chart.js.
		// Chart.js calls Object.defineProperty on whatever arrays it receives, which
		// throws when given a Svelte 5 proxy object.
		const plainLabels: string[] = $state.snapshot(labels) as string[];
		const plainValues: number[] = $state.snapshot(values) as number[];

		if (chart) {
			chart.destroy();
			chart = null;
		}
		if (!canvas || plainLabels.length === 0) return;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// Draw account name labels on top of the bars (afterDraw = after bars are painted).
		const yLabelsPlugin = {
			id: 'yLabels',
			afterDraw(ch: Chart) {
				const yScale = ch.scales['y'];
				const c = ch.ctx;
				const size = Chart.defaults.font.size ?? 12;
				const family = Chart.defaults.font.family ?? 'sans-serif';
				c.save();
				c.fillStyle = '#f5f0e8';
				c.font = `${size}px ${family}`;
				c.textBaseline = 'middle';
				c.textAlign = 'left';
				plainLabels.forEach((label, i) => {
					const y = yScale.getPixelForValue(i);
					const text = label.length > 40 ? label.slice(0, 37) + '…' : label;
					c.fillText(text, 6, y);
				});
				c.restore();
			}
		};

		chart = new Chart(ctx, {
			type: 'bar',
			data: {
				labels: plainLabels,
				datasets: [
					{
						data: plainValues,
						backgroundColor: 'rgba(239, 68, 68, 0.75)',
						borderColor: 'rgba(239, 68, 68, 1)',
						borderWidth: 1
					}
				]
			},
			plugins: [yLabelsPlugin],
			options: {
				indexAxis: 'y',
				responsive: true,
				maintainAspectRatio: false,
				onClick: onclick
					? (event, elements) => {
							if (elements.length > 0) {
								const account = plainLabels[elements[0].index];
								if (account) onclick(account);
								return;
							}
							// Also handle clicks/taps on y-axis tick labels.
							// Use Chart.js normalised event.x/y so this works on both
							// mouse (offsetX/Y) and touch events.
							const yScale = chart?.scales['y'];
							if (!yScale || event.x == null || event.y == null) return;
							if (event.x <= yScale.right) {
								const idx = yScale.getValueForPixel(event.y);
								if (idx !== undefined) {
									const i = Math.round(idx as number);
									if (i >= 0 && i < plainLabels.length) onclick(plainLabels[i]);
								}
							}
						}
					: undefined,
				plugins: {
					legend: { display: false },
					tooltip: {
						callbacks: {
							label: (ctx) => ` ${Number(ctx.raw).toFixed(2)}`
						}
					}
				},
				scales: {
					x: { beginAtZero: true },
					y: {
						afterFit(scale) {
							// Collapse the left label column — labels are drawn by the plugin
							scale.width = 0;
						},
						ticks: { display: false }
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

<div
	class="relative"
	class:cursor-pointer={!!onclick}
	style="height: max(24rem, calc({labels.length} * 2rem + 4rem))"
>
	<canvas bind:this={canvas}></canvas>
</div>
