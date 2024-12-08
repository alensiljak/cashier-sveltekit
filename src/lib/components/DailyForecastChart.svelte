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
		Title
	} from 'chart.js';
	import { onMount } from 'svelte';
	import 'hw-chartjs-plugin-colorschemes/src/plugins/plugin.colorschemes';
	// office.Composite6
	import { Composite6 } from 'hw-chartjs-plugin-colorschemes/src/colorschemes/colorschemes.office';
	import { getAccountBalance, getShortAccountName } from '$lib/services/accountsService';
	import db from '$lib/data/db';
	import type { Account, ScheduledTransaction } from '$lib/data/model';
	import appService from '$lib/services/appService';
	import moment from 'moment';

	interface Props {
		daysCount: number;
		accountNames: string[];
	}
	let { daysCount, accountNames }: Props = $props();

	let defaultCurrency: string;
	let maxDate: moment.Moment;
	let chartDiv: any;
	Chart.register(Title, Legend, BarElement, CategoryScale, LinearScale, BarController);

	onMount(async () => {
		defaultCurrency = await appService.getDefaultCurrency();
		maxDate = moment().add(daysCount, 'days');

		let data = await loadData();

		renderChart(data);
	});

	async function addScx(accountName: string) {
		// project scheduled transactions
		let scxs = await loadScxsFor(accountName);

		// calculate values for subsequent days

		// Perform the calculation.
	}

	function createXAxis() {
		let labels: string[] = new Array(daysCount + 1);

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

	async function loadData() {
		let data: any = {
			datasets: []
		};

		// {
		// 	label: 'third',
		// 	data: [300, 150, 12, 1000.16, 100]
		// }

		for (const accountName of accountNames) {
			let dataset = await populateAccount(accountName);
			data.datasets.push(dataset);
		}

		return data;
	}

	async function loadScxsFor(accountName: string) {
		let scxs: ScheduledTransaction[] = await db.scheduled.orderBy('nextDate').toArray();
		let scxsForAccount = scxs.filter(
			(scx) =>
				scx?.transaction?.postings?.filter((scx) => scx.account === accountName) &&
				scx.transaction.date &&
				scx.transaction.date <= maxDate.toString()
		);
		return scxsForAccount;
	}

	async function populateAccount(accountName: string) {
		// create a dataset record for each account.
		let entry = {
			label: '',
			data: new Array(daysCount + 1)
		};
		// load account
		const account: Account = await db.accounts.get(accountName);
		entry.label = account.getAccountName();
		// todo: add local transactions
		entry.data[0] = getAccountBalance(account, defaultCurrency).amount;

		// add scheduled transactions
		await addScx(accountName);

		return entry;
	}

	function renderChart(data: any) {
		// document.getElementById('chartDiv') as ChartItem
		const ctx = chartDiv.getContext('2d');

		// labels, x-axis
		const labels = createXAxis();
		data.labels = labels;

		// Color palettes:
		// https://nagix.github.io/chartjs-plugin-colorschemes/colorchart.html

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
		const chart = new Chart(ctx, config);
	}
</script>

<div id="chartDiv"></div>
<!-- <canvas use:chartRender={chartData}></canvas> -->
<canvas bind:this={chartDiv} width={400} height={200}> </canvas>
