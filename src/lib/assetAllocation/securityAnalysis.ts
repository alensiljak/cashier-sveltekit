import moment from 'moment';
import { settings, SettingKeys } from '../settings';
import { SyncApiClient } from './syncApiClient';
import appService from '$lib/services/appService';
import { getQueries } from '$lib/sync/sync-queries';
import * as BeancountParser from '$lib/utils/beancountParser';
import * as LedgerParser from '$lib/utils/ledgerParser';
import { UserError } from '$lib/utils/errors';
import { LedgerDataSource, PtaSystems } from '$lib/enums';

const DATE_FORMAT = 'YYYY-MM-DD';

/**
 * Security Analysis for symbols.
 * Calculates yield, etc.
 */

export interface SecurityAnalysis {
	yield: string;
	gainloss: string;
}

export type QueryFn = (bql: string) => { columns: string[]; rows: any[]; errors: any[] };

export class SecurityAnalyser {
	currency: string | undefined;
	private syncApiClient: SyncApiClient | null = null;
	private wasmQueryFn: QueryFn | null = null;
	private ptaSystem: string | null = null;

	constructor(wasmQueryFn?: QueryFn) {
		if (wasmQueryFn) {
			this.wasmQueryFn = wasmQueryFn;
		} else {
			this.syncApiClient = new SyncApiClient();
		}
	}

	/**
	 * Execute a query using either WASM or server backend.
	 */
	private async query(command: string): Promise<Array<any>> {
		if (this.wasmQueryFn) {
			const result = this.wasmQueryFn(command);
			if (result.errors.length > 0) {
				throw new Error(`BQL query failed: ${result.errors.map((e: any) => e.message).join('; ')}`);
			}
			return result.rows;
		}

		// Fall back to server
		if (!this.syncApiClient) {
			throw new Error('No query backend available');
		}
		await this.syncApiClient.init();
		return this.syncApiClient.query(command);
	}

	private async getPtaSystem(): Promise<string> {
		if (!this.ptaSystem) {
			if (this.wasmQueryFn) {
				this.ptaSystem = PtaSystems.rledger;
			} else {
				// Map ledgerDataSource to PTA system for query selection
				const dataSource = (await settings.get(SettingKeys.ledgerDataSource)) as string;
				if (dataSource === LedgerDataSource.filesystem || dataSource === LedgerDataSource.rledger) {
					this.ptaSystem = PtaSystems.rledger;
				} else if (dataSource === LedgerDataSource.beancount) {
					this.ptaSystem = PtaSystems.beancount;
				} else if (dataSource === LedgerDataSource.ledger) {
					this.ptaSystem = PtaSystems.ledger;
				} else {
					this.ptaSystem = PtaSystems.rledger;
				}
			}
		}
		return this.ptaSystem;
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

		const ptaSystem = await this.getPtaSystem();
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

		const ptaSystem = await this.getPtaSystem();
		const queries = getQueries(ptaSystem);
		const command = queries.incomeBalance(symbol, yieldFrom, currency);

		const report = await this.query(command);
		if (report.length == 0) {
			console.warn('No income balance found for symbol ' + symbol);
			return 0;
		}

		let total;
		if (ptaSystem == PtaSystems.ledger) {
			total = LedgerParser.getNumberFromBalanceRow(report);
		} else if (ptaSystem == PtaSystems.beancount || ptaSystem == PtaSystems.rledger) {
			const line = report[0];
			total = BeancountParser.getMoneyFromTupleString(line[0]).quantity;
		} else {
			throw new UserError(
				`Unsupported accounting system: "${ptaSystem}"`,
				'Please set a valid PTA system in settings (ledger or beancount)',
				`Received: "${ptaSystem}". Supported systems are: ledger, beancount, rledger`
			);
		}

		return total;
	}

	async #getValueBalance(symbol: string, currency: string) {
		const ptaSystem = await this.getPtaSystem();
		const queries = getQueries(ptaSystem);
		const command = queries.valueBalance(symbol, currency);

		const report = await this.query(command);

		if (ptaSystem == PtaSystems.ledger) {
			return LedgerParser.getNumberFromBalanceRow(report);
		} else if (ptaSystem == PtaSystems.beancount || ptaSystem == PtaSystems.rledger) {
			const line = report[0];
			return BeancountParser.getMoneyFromTupleString(line[0]).quantity;
		} else {
			throw new UserError(
				`Unsupported accounting system: "${ptaSystem}"`,
				'Please set a valid PTA system in settings (ledger or beancount)',
				`Received: "${ptaSystem}". Supported systems are: ledger, beancount, rledger`
			);
		}
	}

	/**
	 * Parses a 1-line ledger result, when --collapse is used
	 * @param {String} line
	 */
	#getNumberFromCollapseResult(line: string): string {
		if (!line) {
			return 'n/a';
		}
		line = line.trim();

		// -1,139 EUR  Assets
		const parts = line.split(' ');
		if (parts.length != 4) {
			throw new UserError(
				'Unexpected response format from ledger',
				'Please check that your ledger version is compatible',
				`Expected format: "-1,139 EUR  Assets", got: "${line.substring(0, 50)}"`
			);
		}

		let totalNumeric = parts[0];
		totalNumeric = totalNumeric.replaceAll(',', '');
		return totalNumeric;
	}
}
