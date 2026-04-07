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
			options: {
				indexAxis: 'y',
				responsive: true,
				maintainAspectRatio: false,
				onClick: onclick
					? (_event, elements) => {
							if (elements.length === 0) return;
							const account = plainLabels[elements[0].index];
							if (account) onclick(account);
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
						ticks: {
							// Trim long account names to keep bars readable
							callback: function (val) {
								const label = this.getLabelForValue(val as number);
								return label.length > 40 ? label.slice(0, 37) + '…' : label;
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

<div
	class="relative"
	class:cursor-pointer={!!onclick}
	style="height: max(24rem, calc({labels.length} * 2rem + 4rem))"
>
	<canvas bind:this={canvas}></canvas>
</div>
