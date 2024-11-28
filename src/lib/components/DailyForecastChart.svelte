<script lang="ts">
	import {
		BarController,
		BarElement,
		CategoryScale,
		LinearScale,
		Legend,
		Chart,
        Title,
		type ChartItem
	} from 'chart.js';
	import { onMount } from 'svelte';

	interface Props {
		daysCount: number;
		accountNames: string[];
	}
	let { daysCount, accountNames }: Props = $props();

    let chartDiv: any;
    Chart.register(Title, Legend, BarElement, CategoryScale, LinearScale, BarController);

    onMount(() => {
        renderChart();
    })

	function renderChart() {
        // document.getElementById('chartDiv') as ChartItem
        const ctx = chartDiv.getContext('2d');

		var chart = new Chart(ctx, {
			type: 'bar',
            data: {
                labels: ['a', 'day 2'],
                datasets: [
                    {
                        label: 'first!',
                        data: [3, 4, 6, 7200]
                    }
                ]
            }
		});
	}
</script>

<p>Daily Forecast Chart</p>
{daysCount}
{accountNames}

<div id="chartDiv"></div>
<!-- <canvas use:chartRender={chartData}></canvas> -->
 <canvas bind:this={chartDiv} width={400} height={200}>
 </canvas>