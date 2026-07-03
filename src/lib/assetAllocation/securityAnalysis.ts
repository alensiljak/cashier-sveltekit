import appService from '$lib/services/appService';
import {
	computeCommodityGainLoss,
	computeCommodityYield,
	type CommodityDirective,
	type QueryFn
} from './commodityYield';

export type { QueryFn };

/**
 * Security Analysis for symbols.
 * Calculates yield, etc.
 *
 * Linking to `commodities` uses `isin`/`ticker` metadata when a commodity
 * directive declares it (see commodityYield.ts), and falls back to the
 * legacy `currency = symbol` / `Income...:<symbol>` account-name convention
 * otherwise — both conventions are checked, not either/or, so a book only
 * partially tagged with isin/ticker meta still totals correctly.
 */

export interface SecurityAnalysis {
	yield: string;
	gainloss: string;
}

export class SecurityAnalyser {
	currency: string | undefined;
	private wasmQueryFn: QueryFn;
	private commodities: CommodityDirective[];

	constructor(wasmQueryFn: QueryFn, commodities: CommodityDirective[]) {
		this.wasmQueryFn = wasmQueryFn;
		this.commodities = commodities;
	}

	private target(symbol: string): CommodityDirective {
		return this.commodities.find((c) => c.currency === symbol) ?? { currency: symbol, meta: {} };
	}

	/**
	 * Calculate the yield in the last 12 months.
	 * This value is affected by the recent purchases, which result in seemingly lower yield!
	 */
	async getYield(symbol: string): Promise<string> {
		const currency = (await appService.getDefaultCurrency()) as string;
		this.currency = currency;

		const result = await computeCommodityYield(
			this.wasmQueryFn,
			this.target(symbol),
			this.commodities,
			currency
		);
		return result.yieldPct;
	}

	async getGainLoss(symbol: string) {
		const currency = await appService.getDefaultCurrency();
		this.currency = currency;

		const result = await computeCommodityGainLoss(
			this.wasmQueryFn,
			this.target(symbol),
			this.commodities,
			currency
		);
		return result.summary;
	}
}
