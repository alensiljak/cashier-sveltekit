<!--
  StackedExpenseChart - vertical stacked bar chart showing expense totals per month,
  broken down by main category. Months on the X-axis; each bar segment is a category.
  Categorical colors follow a fixed hue order (never reassigned by rank); "Other" is
  a neutral gray residual bucket, not a competing hue.
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
		/** Month labels, oldest to newest */
		months: string[];
		/** Category names in display order (e.g. top categories by total, "Other" last) */
		categories: string[];
		/** categories.length arrays, each with months.length values */
		series: number[][];
		/** Called with (category, monthIndex) when a segment is clicked */
		onclick?: (category: string, monthIndex: number) => void;
	}

	let { months, categories, series, onclick }: Props = $props();

	Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

	// Fixed categorical hue order (validated for adjacent-pair CVD/contrast on stacked bars).
	// "Other" always renders in the trailing neutral slot, never one of the hues.
	const CATEGORY_COLORS = [
		'#2a78d6', // blue
		'#eb6834', // orange
		'#1baf7a', // aqua
		'#eda100', // yellow
		'#e87ba4', // magenta
		'#008300' // green
	];
	const OTHER_COLOR = '#898781'; // muted ink — residual bucket, not a competing hue

	function colorFor(category: string, index: number): string {
		return category === 'Other' ? OTHER_COLOR : CATEGORY_COLORS[index % CATEGORY_COLORS.length];
	}

	let canvas: HTMLCanvasElement | undefined = $state();
	let chart: Chart | null = null;

	$effect(() => {
		const plainMonths: string[] = $state.snapshot(months) as string[];
		const plainCategories: string[] = $state.snapshot(categories) as string[];
		const plainSeries: number[][] = $state.snapshot(series) as number[][];

		if (chart) {
			chart.destroy();
			chart = null;
		}
		if (!canvas || plainMonths.length === 0 || plainCategories.length === 0) return;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		chart = new Chart(ctx, {
			type: 'bar',
			data: {
				labels: plainMonths,
				datasets: plainCategories.map((category, i) => ({
					label: category,
					data: plainSeries[i] ?? [],
					backgroundColor: colorFor(category, i),
					borderWidth: 0
				}))
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				onClick: onclick
					? (_event, elements) => {
							if (elements.length === 0) return;
							const { datasetIndex, index } = elements[0];
							onclick(plainCategories[datasetIndex], index);
						}
					: undefined,
				plugins: {
					legend: { display: true, position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12 } },
					tooltip: {
						callbacks: {
							label: (c) => ` ${c.dataset.label}: ${Number(c.raw).toFixed(2)}`
						}
					}
				},
				scales: {
					x: { stacked: true, ticks: { font: { size: 11 } } },
					y: { stacked: true, beginAtZero: true }
				}
			}
		});

		return () => {
			chart?.destroy();
			chart = null;
		};
	});
</script>

<div class="relative w-full" style="height: 24rem" class:cursor-pointer={!!onclick}>
	<canvas bind:this={canvas}></canvas>
</div>
