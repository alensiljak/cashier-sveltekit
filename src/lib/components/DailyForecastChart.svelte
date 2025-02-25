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
	// @ts-ignore
	import { Composite6 } from 'hw-chartjs-plugin-colorschemes/src/colorschemes/colorschemes.office';
	import { getAccountBalance, getShortAccountName } from '$lib/services/accountsService';
	import db from '$lib/data/db';
	import type { Account, ScheduledTransaction, Xact } from '$lib/data/model';
	import appService from '$lib/services/appService';
	import moment from 'moment';
	import { XactAugmenter } from '$lib/utils/xactAugmenter';
	import { ISODATEFORMAT } from '$lib/constants';
	import Notifier from '$lib/utils/notifier';

	interface Props {
		daysCount: number;
		accountNames: string[];
	}
	let { daysCount, accountNames }: Props = $props();

	Notifier.init();

	let defaultCurrency: string;
	let maxDate: moment.Moment;
	let chartDiv: any;
	Chart.register(Title, Legend, BarElement, CategoryScale, LinearScale, BarController);

	onMount(async () => {
		defaultCurrency = await appService.getDefaultCurrency();
		maxDate = moment().add(daysCount, 'days');

		try {
			let data = await loadData();

			renderChart(data);
		} catch (error) {
			Notifier.error('Error loading data for the chart.');
			console.error(error);
		}
	});

	async function addScxData(accountName: string, amounts: number[]): Promise<number[]> {
		// project scheduled transactions
		let scxs = await loadScxsFor(accountName);

		// todo: project the schedule into the selected period (i.e. if a xact repeats daily, it should be
		// included 7 times in a weekly forecast).

		// calculate values for subsequent days
		amounts = addScxAmounts(scxs, amounts, accountName);

		// Perform the calculation.
		amounts = calculateDailyAmounts(amounts);

		return amounts;
	}

	function addScxAmounts(
		scxs: ScheduledTransaction[],
		amounts: number[],
		accountName: string
	): number[] {
		let xacts = scxs.map((s) => s.transaction) as Xact[];
		if (!xacts || xacts.length === 0) return amounts;
		xacts = XactAugmenter.calculateEmptyPostingAmounts(xacts);

		// start from today
		const today = moment().startOf('day');
		for (var scx of scxs) {
			let diff = moment(scx.nextDate).diff(today, 'days');
			// Handle overdue payments (negative days).
			if (diff < 0) diff = 0;

			const postings = scx.transaction?.postings.filter((p) => p.account == accountName);
			if (!postings || postings?.length === 0) continue;

			// add all the posting amounts
			let dailyAmount = 0;
			for (var posting of postings) {
				if (!posting.amount) continue;
				dailyAmount += posting.amount;
			}
			amounts[diff] += dailyAmount;
		}

		return amounts;
	}

	/**
	 * Calculates total daily amounts. The previous amounts contain only the amounts for that particular day.
	 * A kind of a hack. Since the daily amounts have been inserted already, just recalculate the daily balance
	 * based on the balance of the previous day.
	 * @param amounts transaction amounts per day
	 */
	function calculateDailyAmounts(amounts: number[]): number[] {
		let balance = 0; // balance on the previous day. Running balance.
		for (let i = 0; i < amounts.length; i++) {
			let dailyAmount = amounts[i] || 0;
			// add today's transactions to the running balance.
			let dailyBalance = balance + dailyAmount;
			// set the value in the daily cell, in the array.
			amounts[i] = dailyBalance;
			// update the running balance.
			balance = dailyBalance;
		}

		return amounts;
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
			let dataset = await createDatasetFor(accountName);
			data.datasets.push(dataset);
		}

		return data;
	}

	async function loadScxsFor(accountName: string) {
		let scxs: ScheduledTransaction[] = await db.scheduled.orderBy('nextDate').toArray();
		let scxsForAccount = scxs.filter(
			(scx) =>
				scx?.transaction?.postings?.filter((scx) => scx.account == accountName).length &&
				scx.transaction.date &&
				scx.transaction.date <= maxDate.format(ISODATEFORMAT).toString()
		);
		return scxsForAccount;
	}

	async function createDatasetFor(accountName: string) {
		// create a dataset record for each account.
		let dataset = {
			label: '',
			data: new Array(daysCount + 1)
		};

		// load account
		const account: Account = await db.accounts.get(accountName);
		dataset.label = account.getAccountName();

		// add default values.
		for (var i = 0; i < dataset.data.length; i++) {
			dataset.data[i] = 0;
		}

		// todo: add local transactions

		dataset.data[0] = getAccountBalance(account, defaultCurrency).quantity;

		// add scheduled transactions
		dataset.data = await addScxData(accountName, dataset.data);

		return dataset;
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
