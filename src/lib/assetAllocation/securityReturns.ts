/**
 * Securities list data — the cheap, list-level view of cost-bearing
 * commodities (investments). Distinct from the generic `commodities` list:
 * a *security* here is any commodity held in a position with a cost basis
 * (an open lot where `cost_number IS NOT NULL`). Currencies (`EUR`, `USD`)
 * are held at no cost, so they drop out automatically.
 *
 * Data is fetched with the same `buildLotsQuery` the Commodity Detail page
 * and Security Analysis use (active open lots, cost present), so the default
 * list is a single aggregate query. "Show Closed" adds the closed lots query
 * plus one register-style query to derive realized gain/loss. Expensive
 * per-symbol analytics (money-weighted ROI, time-weighted return) belong on
 * the Commodity Detail page, not here.
 *
 * Note: like the rest of the app's lots queries, cost is reported in the
 * lot's `cost_currency` while value is converted to the report currency.
 * For single-currency investment books (the common case, and the demo) the
 * two coincide; multi-currency cost baselines would need a converted-cost
 * column that `buildLotsQuery` does not currently emit.
 */
import * as BeancountParser from '$lib/utils/beancountParser';
import { buildLotsQuery } from '$lib/services/quickQueryBuilder';
import type { CommodityDirective, QueryFn } from './commodityYield';

export interface SecurityListItem {
	symbol: string;
	name?: string;
	/** Latest quoted price, or null if the security has no price directives. */
	lastPrice: number | null;
	lastPriceCurrency: string;
	/** Current market value of open lots, converted to the report currency. 0 for fully-closed positions. */
	marketValue: number;
	/** Total cost basis of open lots, or (for closed) the amount originally invested. */
	costBasis: number;
	/** marketValue - costBasis for open positions; realized gain/loss for closed ones. */
	gainLoss: number;
	/** gainLoss / costBasis * 100. */
	gainLossPct: number;
	/** True when the security has no open lots (fully sold) and is only listed because "Show Closed" is on. */
	closed: boolean;
}

interface PricePoint {
	date: string;
	price: number;
	currency: string;
}

/** Parses a money tuple string ("123.45 EUR") or an {number,currency} cell. */
function moneyQuantity(cell: unknown): number {
	if (cell == null) return 0;
	if (typeof cell === 'number') return cell;
	if (typeof cell === 'string') {
		const v = BeancountParser.getMoneyFromTupleString(cell);
		return v?.quantity ?? 0;
	}
	if (typeof cell === 'object') {
		const c = cell as { number?: string | number; quantity?: string | number };
		const n = c.number ?? c.quantity;
		if (n == null) return 0;
		const num = typeof n === 'string' ? parseFloat(n) : Number(n);
		return isNaN(num) ? 0 : num;
	}
	return 0;
}

/** Pulls {price, currency} out of a `prices.amount` cell ({number, currency}). */
function parsePriceAmount(raw: unknown): { price: number; currency: string } {
	if (raw == null || typeof raw !== 'object') return { price: NaN, currency: '' };
	const v = raw as { number?: string | number; currency?: string };
	const n = v.number;
	if (n == null) return { price: NaN, currency: v.currency ?? '' };
	const num = typeof n === 'string' ? parseFloat(n) : Number(n);
	return { price: isNaN(num) ? NaN : num, currency: v.currency ?? '' };
}

function metaName(meta: Record<string, unknown>): string | undefined {
	const v = meta?.['name'];
	return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Keeps the latest dated price per currency from a `prices` result set. */
function lastPricesByCurrency(columns: string[], rows: unknown[][]): Map<string, PricePoint> {
	const dateIdx = columns.indexOf('date');
	const curIdx = columns.indexOf('currency');
	const amtIdx = columns.indexOf('amount');
	const map = new Map<string, PricePoint>();
	for (const row of rows) {
		const cur = String(row[curIdx] ?? '');
		const { price, currency } = parsePriceAmount(row[amtIdx]);
		if (isNaN(price)) continue;
		const rawDate = row[dateIdx];
		const date =
			typeof rawDate === 'string'
				? rawDate.slice(0, 10)
				: rawDate instanceof Date
					? rawDate.toISOString().slice(0, 10)
					: String(rawDate);
		const existing = map.get(cur);
		if (!existing || date > existing.date) map.set(cur, { date, price, currency });
	}
	return map;
}

/** Aggregates a lots-query result into marketValue (from value/converted_value)
 *  and costBasis (from cost) per symbol. */
function aggregateLots(
	columns: string[],
	rows: unknown[][]
): Map<string, { marketValue: number; costBasis: number }> {
	const symIdx = columns.indexOf('symbol');
	const valIdx =
		columns.indexOf('converted_value') >= 0
			? columns.indexOf('converted_value')
			: columns.indexOf('value');
	const costIdx = columns.indexOf('cost');

	const map = new Map<string, { marketValue: number; costBasis: number }>();
	for (const row of rows) {
		const sym = String(row[symIdx] ?? '');
		const agg = map.get(sym) ?? { marketValue: 0, costBasis: 0 };
		agg.marketValue += moneyQuantity(row[valIdx]);
		agg.costBasis += moneyQuantity(row[costIdx]);
		map.set(sym, agg);
	}
	return map;
}

/** Realized gain/loss and total invested for a set of securities, derived from
 *  their postings. Total realized is lot-matching-independent:
 *  Σ_sells(proceeds − cost_of_sold) = Σ_sells(−value − (−units·cost_number)). */
function computeRealized(
	columns: string[],
	rows: unknown[][]
): Map<string, { invested: number; realized: number }> {
	const symIdx = columns.indexOf('symbol');
	const unitsIdx = columns.indexOf('units');
	const costIdx = columns.indexOf('cost_number');
	const valIdx = columns.indexOf('value');

	const map = new Map<string, { invested: number; realized: number }>();
	for (const row of rows) {
		const sym = String(row[symIdx] ?? '');
		const units = moneyQuantity(row[unitsIdx]);
		const costNum = moneyQuantity(row[costIdx]);
		const val = moneyQuantity(row[valIdx]);
		const agg = map.get(sym) ?? { invested: 0, realized: 0 };
		if (units > 0) {
			agg.invested += units * costNum;
		} else if (units < 0) {
			agg.realized += -val - -units * costNum;
		}
		map.set(sym, agg);
	}
	return map;
}

/**
 * Returns every cost-bearing commodity (security) with its market value,
 * cost basis, unrealized gain/loss, and latest price. Fetches all open lots
 * in one `buildLotsQuery` call, then aggregates per symbol.
 *
 * When `includeClosed` is true, fully-closed securities (no open lots) are
 * discovered via the closed lots query and appended with their realized
 * gain/loss (and amount invested), derived from one register-style query.
 */
export async function getSecuritiesList(
	queryFn: QueryFn,
	directives: CommodityDirective[],
	reportCurrency: string,
	includeClosed = false
): Promise<SecurityListItem[]> {
	const ccy = reportCurrency || 'EUR';

	const activeRes = await queryFn(
		buildLotsQuery({
			account: [],
			currency: [],
			exchange: ccy,
			average: false,
			active: true,
			showAll: false,
			closed: false
		})
	);
	const activeMap = aggregateLots(activeRes.columns as string[], activeRes.rows as unknown[][]);

	let closedSymbols: string[] = [];
	if (includeClosed) {
		const closedRes = await queryFn(
			buildLotsQuery({
				account: [],
				currency: [],
				exchange: ccy,
				average: false,
				active: false,
				showAll: false,
				closed: true
			})
		);
		const closedMap = aggregateLots(closedRes.columns as string[], closedRes.rows as unknown[][]);
		closedSymbols = [...closedMap.keys()].filter((s) => !activeMap.has(s));
	}

	// Latest price per currency (covers every commodity; we keep only universe symbols).
	const priceRes = await queryFn(`SELECT date, currency, amount FROM prices ORDER BY date`);
	const priceMap = lastPricesByCurrency(priceRes.columns as string[], priceRes.rows as unknown[][]);

	const nameBySymbol = new Map(directives.map((d) => [d.currency, metaName(d.meta)]));

	const items: SecurityListItem[] = [...activeMap.entries()].map(([symbol, agg]) => {
		const gainLoss = agg.marketValue - agg.costBasis;
		const price = priceMap.get(symbol);
		return {
			symbol,
			name: nameBySymbol.get(symbol),
			lastPrice: price ? price.price : null,
			lastPriceCurrency: price?.currency || ccy,
			marketValue: agg.marketValue,
			costBasis: agg.costBasis,
			gainLoss,
			gainLossPct: agg.costBasis === 0 ? 0 : (gainLoss / agg.costBasis) * 100,
			closed: false
		};
	});

	if (closedSymbols.length > 0) {
		const currencyList = closedSymbols.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ');
		const regRes = await queryFn(
			`SELECT date, currency(units(position)) as symbol, number(units(position)) as units, cost_number, value(position) as value WHERE currency IN (${currencyList}) ORDER BY date`
		);
		const realizedBySym = computeRealized(regRes.columns as string[], regRes.rows as unknown[][]);
		for (const symbol of closedSymbols) {
			const r = realizedBySym.get(symbol) ?? { invested: 0, realized: 0 };
			const price = priceMap.get(symbol);
			items.push({
				symbol,
				name: nameBySymbol.get(symbol),
				lastPrice: price ? price.price : null,
				lastPriceCurrency: price?.currency || ccy,
				marketValue: 0,
				costBasis: r.invested,
				gainLoss: r.realized,
				gainLossPct: r.invested === 0 ? 0 : (r.realized / r.invested) * 100,
				closed: true
			});
		}
	}

	return items.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
