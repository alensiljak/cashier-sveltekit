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
		type ChartData,
		type ChartOptions,
		LinearScale,
		Legend,
		Chart,
		Title
	} from 'chart.js';
	import { onMount } from 'svelte';
	import type { Unsubscriber } from 'svelte/store';
	import 'hw-chartjs-plugin-colorschemes/src/plugins/plugin.colorschemes';
	// office.Composite6
	// @ts-ignore
	import { Composite6 } from 'hw-chartjs-plugin-colorschemes/src/colorschemes/colorschemes.office';
	import { getShortAccountName } from '$lib/services/accountsService';
	import db from '$lib/data/db';
	import { type ScheduledTransaction, type Xact } from '$lib/data/model';
	import appService from '$lib/services/appService';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
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
	let chartDiv: HTMLCanvasElement | null = null;
	let chart: Chart<'bar'> | null = null;

	Chart.register(Title, Legend, BarElement, CategoryScale, LinearScale, BarController);

	onMount(() => {
		chart = renderChart(createEmptyChartData());

		const unsubscribe: Unsubscriber = fullLedgerService.loaded.subscribe((loaded) => {
			if (!loaded) {
				updateChart(createEmptyChartData());
				return;
			}

			void loadAndRenderChart();
		});

		return () => {
			unsubscribe();
			chart?.destroy();
			chart = null;
		};
	});

	async function loadAndRenderChart() {
		defaultCurrency = await appService.getDefaultCurrency();
		maxDate = moment().add(daysCount, 'days');

		try {
			let data = await loadData();
			updateChart(data);
		} catch (error) {
			Notifier.error('Error loading data for the chart.');
			console.error(error);
		}
	}

	async function addScxData(accountName: string, amounts: number[]): Promise<number[]> {
		// project scheduled transactions
		let scxs = await loadScxsFor(accountName);

		// TODO: project the schedule into the selected period (i.e. if a xact repeats daily,
		// it should be included 7 times in a weekly forecast).

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
		for (let scx of scxs) {
			let diff = moment(scx.nextDate).diff(today, 'days');
			// Handle overdue payments (negative days).
			if (diff < 0) diff = 0;

			const postings = scx.transaction?.postings.filter((p) => p.account == accountName);
			if (!postings || postings?.length === 0) continue;

			// add all the posting amounts
			let dailyAmount = 0;
			for (let posting of postings) {
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
		let labels: string[] = Array.from({ length: daysCount + 1 }, () => '');

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

	function createEmptyChartData(): ChartData<'bar'> {
		return {
			labels: createXAxis(),
			datasets: []
		};
	}

	/** Fetch current balances for selected accounts via BQL. */
	async function loadAccountBalances(): Promise<Record<string, number>> {
		const balances: Record<string, number> = {};

		// Build a filter for only the selected accounts.
		const inList = accountNames.map((name) => `'${name}'`).join(', ');
		const bql = `SELECT account, sum(number) as balance, currency WHERE account in (${inList}) GROUP BY account, currency ORDER BY account`;
		const result = await fullLedgerService.query(bql);

		const colAccount = result.columns.indexOf('account');
		const colBalance = result.columns.indexOf('balance');
		const colCurrency = result.columns.indexOf('currency');

		for (const row of result.rows as unknown[][]) {
			const account = row[colAccount] as string;
			const balance = Number(row[colBalance]) || 0;
			const currency = row[colCurrency] as string;

			// Prefer the balance in default currency; otherwise take the first one found.
			if (currency === defaultCurrency || !(account in balances)) {
				balances[account] = balance;
			}
		}

		return balances;
	}

	async function loadData(): Promise<ChartData<'bar'>> {
		const balances = await loadAccountBalances();
		const datasets = [];

		for (const accountName of accountNames) {
			let dataset = await createDatasetFor(accountName, balances[accountName] ?? 0);
			datasets.push(dataset);
		}

		return {
			labels: createXAxis(),
			datasets
		};
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

	async function createDatasetFor(accountName: string, currentBalance: number) {
		let dataset = {
			label: getShortAccountName(accountName),
			data: Array.from<number>({ length: daysCount + 1 }).fill(0)
		};

		// Day-0 is the current balance from BQL.
		dataset.data[0] = currentBalance;

		// add scheduled transactions
		dataset.data = await addScxData(accountName, dataset.data);

		return dataset;
	}

	function updateChart(data: ChartData<'bar'>) {
		if (!chart) return;
		chart.data = data;
		chart.update();
	}

	function renderChart(data: ChartData<'bar'>) {
		// document.getElementById('chartDiv') as ChartItem
		if (!chartDiv) {
			throw new Error('Could not initialize forecast chart canvas.');
		}

		const ctx = chartDiv.getContext('2d');
		if (!ctx) {
			throw new Error('Could not initialize forecast chart context.');
		}

		// Color palettes:
		// https://nagix.github.io/chartjs-plugin-colorschemes/colorchart.html

		const options: ChartOptions<'bar'> = {
			plugins: {
				legend: {
					labels: {
						usePointStyle: true
					}
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
		};

		const config: any = {
			type: 'bar',
			data,
			options: {
				...options,
				plugins: {
					...options.plugins,
					colorschemes: {
						scheme: Composite6
					}
				}
			}
		};

		return new Chart<'bar'>(ctx, config);
	}
</script>

<canvas bind:this={chartDiv} width={400} height={200}></canvas>
