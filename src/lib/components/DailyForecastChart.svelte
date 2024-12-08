<!-- 
 Daily Forecast Chart
 Used on home screen card.
 Implemented using https://www.chartjs.org/.
-->
<script lang="ts">
	import {
		BarController,
		BarElement,
		CategoryScale,
		LinearScale,
		Legend,
		Chart,
		Title,
	} from 'chart.js';
	import { onMount } from 'svelte';
	import 'hw-chartjs-plugin-colorschemes/src/plugins/plugin.colorschemes';
	// office.Composite6
	import { Composite6 } from 'hw-chartjs-plugin-colorschemes/src/colorschemes/colorschemes.office';

	interface Props {
		daysCount: number;
		accountNames: string[];
	}
	let { daysCount, accountNames }: Props = $props();

	let chartDiv: any;
	Chart.register(Title, Legend, BarElement, CategoryScale, LinearScale, BarController);

	onMount(() => {
		renderChart();
	});

	function createXAxis() {
		let labels: string[] = new Array(daysCount);

		for (let i = 0; i <= daysCount; i++) {
			// labels on weeks only
			if (i % 7 === 0) {
				labels[i] = i.toString();
			} else {
				labels[i] = '';
			}
		}
		return labels;
	}

	function renderChart() {
		// document.getElementById('chartDiv') as ChartItem
		const ctx = chartDiv.getContext('2d');

		// labels, x-axis
		const labels = createXAxis();
		const data = {
			labels: labels,
			datasets: [
				{
					label: 'first!',
					data: [3, 4, 6, 7200, 300]
				},
				{
					label: 'second',
					data: [8, 2400, 4320, 271.16, 123.18]
				},
				{
					label: 'third',
					data: [300, 150, 12, 1000.16, 100]
				}
			]
		};

		const config: any = {
			type: 'bar',
			data: data,
			options: {
				plugins: {
					legend: {
						labels: {
							usePointStyle: true
						}
					},
					colorschemes: {
						scheme: Composite6
					}
				},
				responsive: true,
				scales: {
					x: {
						stacked: true
					},
					y: {
						stacked: true
					}
				}
			}
		};
		var chart = new Chart(ctx, config);
	}
</script>

<div id="chartDiv"></div>
<!-- <canvas use:chartRender={chartData}></canvas> -->
<canvas bind:this={chartDiv} width={400} height={200}> </canvas>
