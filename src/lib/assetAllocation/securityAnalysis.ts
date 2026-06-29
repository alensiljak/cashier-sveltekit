import moment from 'moment';
import { settings, SettingKeys } from '../settings';
import appService from '$lib/services/appService';
import { getQueries } from '$lib/sync/sync-queries';
import * as BeancountParser from '$lib/utils/beancountParser';
import { UserError } from '$lib/utils/errors';
import { PtaSystems } from '$lib/enums';

const DATE_FORMAT = 'YYYY-MM-DD';

/**
 * Security Analysis for symbols.
 * Calculates yield, etc.
 */

export interface SecurityAnalysis {
	yield: string;
	gainloss: string;
}

export type QueryFn = (bql: string) => Promise<{ columns: string[]; rows: any[]; errors: any[] }>;

export class SecurityAnalyser {
	currency: string | undefined;
	private wasmQueryFn: QueryFn;
	private ptaSystem: string | null = null;

	constructor(wasmQueryFn: QueryFn) {
		this.wasmQueryFn = wasmQueryFn;
	}

	private async query(command: string): Promise<Array<any>> {
		const result = await this.wasmQueryFn(command);
		if (result.errors.length > 0) {
			throw new Error(`BQL query failed: ${result.errors.map((e: any) => e.message).join('; ')}`);
		}
		return result.rows;
	}

	/**
	 * Calculate the yield in the last 12 months.
	 * This value is affected by the recent purchases, which result in seemingly lower yield!
	 */
	async getYield(symbol: string): Promise<string> {
		const currency = (await settings.get(SettingKeys.currency)) as string;
		this.currency = currency;

		// Retrieve income amount.
		const incomeStr = await this.#getIncomeBalance(symbol);
		let income = Number(incomeStr);
		// turn into a positive number
		income = income * -1;

		// Retrieve the current value of the holding.
		const valueStr = await this.#getValueBalance(symbol, currency);
		const value = Number(valueStr);

		// Calculate
		let _yield = null;
		if (value == 0.0) {
			_yield = 0.0;
		} else {
			_yield = (income * 100) / value;
		}

		const result = _yield.toFixed(2) + '%';

		return result;
	}

	async getGainLoss(symbol: string) {
		const currency = await appService.getDefaultCurrency();
		this.currency = currency;

		const ptaSystem = PtaSystems.rledger;
		const queries = getQueries(ptaSystem);
		const command = queries.gainLoss(symbol, currency);

		const report: Array<any> = await this.query(command);
		if (report.length == 0) {
			return 'n/a';
		}
		if (report.length > 1) {
			throw new UserError(
				`Multiple gain/loss records found for ${symbol}`,
				`Check your ${ptaSystem} data for duplicate entries for this symbol`,
				'This usually happens when the same symbol exists in multiple accounts without proper cost basis tracking'
			);
		}
		// With Beancount, the result is an array of all accounts with this column values.
		const line: Array<string> = report[0];
		// Line contains columns: [(594.52 USD), (594.52 USD)]
		const costBasis = BeancountParser.getMoneyFromTupleString(line[0]).quantity;
		const marketValue = BeancountParser.getMoneyFromTupleString(line[1]).quantity;
		const gainLoss = marketValue - costBasis;

		const result = `${gainLoss.toFixed(2)} ${this.currency}, ${((gainLoss / costBasis) * 100).toFixed(2)}%`;
		return result;
	}

	/**
	 * Get the income in the last year.
	 * @returns {Promise<number>} The amount from the symbol's income balance
	 */
	async #getIncomeBalance(symbol: string): Promise<number> {
		const currency = this.currency as string;
		const yieldFrom = moment().subtract(1, 'year').format(DATE_FORMAT);

		const ptaSystem = PtaSystems.rledger;
		const queries = getQueries(ptaSystem);
		const command = queries.incomeBalance(symbol, yieldFrom, currency);

		const report = await this.query(command);
		if (report.length == 0) {
			console.warn('No income balance found for symbol ' + symbol);
			return 0;
		}

		let total;
		const line = report[0];
		total = BeancountParser.getMoneyFromTupleString(line[0]).quantity;

		return total;
	}

	async #getValueBalance(symbol: string, currency: string) {
		const queries = getQueries(PtaSystems.rledger);
		const command = queries.valueBalance(symbol, currency);

		const report = await this.query(command);

		const line = report[0];
		return BeancountParser.getMoneyFromTupleString(line[0]).quantity;
	}
}
