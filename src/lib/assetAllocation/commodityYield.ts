/**
 * Proof-of-concept: link distributions (dividends/interest) to a security via
 * `isin`/`ticker` metadata instead of an account-naming convention.
 *
 * Today's SecurityAnalyser.getYield() assumes an income account whose last
 * colon-segment literally equals the ledger currency code (e.g.
 * `Income:Dividends:VTI`), and that a security only ever trades under one
 * currency code. Neither holds once the same fund trades under several
 * ticker symbols (different exchanges) or the user wants a flatter chart of
 * accounts (e.g. a single `Income:Dividends`).
 *
 * Convention explored here:
 * - `commodity` directives optionally carry `isin` and/or `ticker` meta.
 * - Distribution transactions tag `isin` (preferred, exchange-independent)
 *   or `ticker` — on the *transaction* or on the specific income *posting*,
 *   whichever is convenient for the importer; both are matched (see below).
 *
 *     2020-01-01 commodity VTI
 *       isin: "US9229087692"
 *
 *     2024-06-01 * "Vanguard" "Dividend"
 *       isin: "US9229087692"
 *       Income:Dividends   -12.34 USD
 *       Assets:Investments:Brokerage:Cash  12.34 USD
 *
 * Linking happens in two steps:
 * 1. Client-side (JS): group every `commodity` directive that shares the
 *    target's `isin` meta -> the set of currency codes this security trades
 *    under. This is unavoidable — BQL has no queryable `commodity` table
 *    with a currency+meta join, so meta on `commodity` directives can only
 *    be read via getDirectives().
 * 2. BQL: value keeps matching on `currency IN (...)` (extended from
 *    today's `currency = symbol`). Income OR-combines the new
 *    `ANY_META('isin') = '<isin>'` condition (posting meta first, falls
 *    back to transaction meta — so tagging either level works) with the
 *    legacy `Income...:<symbol>` account-name regex (for every linked
 *    currency) — not either/or. A book only partially tagged (some
 *    distributions carry `isin`, others still rely on the old per-symbol
 *    income account, e.g. while importers are updated) still totals
 *    correctly; a posting matching both conditions is counted once.
 *
 * Falls back to the pure legacy account-name convention when a commodity
 * has no `isin`/`ticker` meta at all, so this is adoptable incrementally,
 * one commodity — and one transaction — at a time.
 */
import moment from 'moment';
import * as BeancountParser from '$lib/utils/beancountParser';
import { UserError } from '$lib/utils/errors';

const DATE_FORMAT = 'YYYY-MM-DD';

export type QueryFn = (bql: string) => Promise<{ columns: string[]; rows: any[]; errors: any[] }>;
export interface CommodityDirective {
	currency: string;
	meta: Record<string, unknown>;
}

/** Maps raw `getDirectives()` output down to the commodity directives, ready for linking. */
export function commoditiesFromDirectives(directives: unknown[]): CommodityDirective[] {
	return (directives as Array<{ type?: string; currency?: unknown; meta?: unknown }>)
		.filter((d) => d.type === 'commodity')
		.map((d) => ({
			currency: String(d.currency ?? ''),
			meta: (d.meta as Record<string, unknown>) ?? {}
		}));
}

export type LinkStrategy = 'isin' | 'ticker' | 'symbol';

export interface CommodityYieldResult {
	/** Formatted "NN.NN%", trailing-12-months income over current value. */
	yieldPct: string;
	income: number;
	value: number;
	/** How the security was resolved: shared isin, shared ticker, or bare currency code (legacy). */
	matchedBy: LinkStrategy;
	/** Every currency code included in the value/income aggregation. */
	linkedCurrencies: string[];
}

function metaString(meta: Record<string, unknown>, key: string): string | undefined {
	const value = meta[key];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Escapes a value for embedding in a single-quoted BQL string literal. */
function escapeBqlString(value: string): string {
	return value.replace(/'/g, "''");
}

async function runQuery(
	queryFn: QueryFn,
	bql: string
): Promise<{ columns: string[]; rows: unknown[][] }> {
	const result = await queryFn(bql);
	if (result.errors.length > 0) {
		throw new Error(
			`BQL query failed: ${result.errors.map((e: any) => e.message ?? String(e)).join('; ')}`
		);
	}
	return { columns: result.columns, rows: result.rows as unknown[][] };
}

function firstAmount(rows: unknown[][]): number {
	if (rows.length === 0) return 0;
	const row = rows[0] as string[];
	if (row.length === 0 || row[0] == null) return 0;
	return BeancountParser.getMoneyFromTupleString(row[0]).quantity;
}

/**
 * Resolves the set of ledger currency codes that represent the same
 * underlying security as `target` (same declared isin, or the ticker, or
 * just itself if neither meta key is present).
 */
export function resolveLinkedCurrencies(
	target: CommodityDirective,
	allCommodities: CommodityDirective[]
): { currencies: string[]; matchedBy: LinkStrategy; metaKey?: string; metaValue?: string } {
	const isin = metaString(target.meta, 'isin');
	if (isin) {
		const currencies = allCommodities
			.filter((c) => metaString(c.meta, 'isin') === isin)
			.map((c) => c.currency);
		return {
			currencies: currencies.length > 0 ? currencies : [target.currency],
			matchedBy: 'isin',
			metaKey: 'isin',
			metaValue: isin
		};
	}

	const ticker = metaString(target.meta, 'ticker');
	if (ticker) {
		const currencies = allCommodities
			.filter((c) => metaString(c.meta, 'ticker') === ticker)
			.map((c) => c.currency);
		return {
			currencies: currencies.length > 0 ? currencies : [target.currency],
			matchedBy: 'ticker',
			metaKey: 'ticker',
			metaValue: ticker
		};
	}

	return { currencies: [target.currency], matchedBy: 'symbol' };
}

/**
 * Trailing-12-months yield for a commodity, using isin/ticker metadata to
 * link distributions and holdings across every currency code the security
 * trades under.
 *
 * Income matching is *additive*, not either/or: it OR-combines the meta
 * condition with the legacy `Income...:<symbol>` account-name regex (for
 * every linked currency), so a book that is only partially migrated —
 * some distributions tagged with `isin`, others still relying on the old
 * per-symbol income account — gets a correct total either way. A posting
 * matching both conditions is still counted once (single WHERE, not a
 * UNION of two queries).
 */
export async function computeCommodityYield(
	queryFn: QueryFn,
	target: CommodityDirective,
	allCommodities: CommodityDirective[],
	reportCurrency: string
): Promise<CommodityYieldResult> {
	const { currencies, matchedBy, metaKey, metaValue } = resolveLinkedCurrencies(
		target,
		allCommodities
	);
	const yieldFrom = moment().subtract(1, 'year').format(DATE_FORMAT);
	const currencyList = currencies.map((c) => `'${escapeBqlString(c)}'`).join(', ');

	const valueBql = `SELECT str(CONVERT(value(sum(position)), '${escapeBqlString(reportCurrency)}')) as value
        WHERE currency IN (${currencyList})`;

	const legacyCondition = `account ~ '^Income.*:(${currencies.map(escapeBqlString).join('|')})$'`;
	const matchCondition =
		metaKey && metaValue
			? `(ANY_META('${metaKey}') = '${escapeBqlString(metaValue)}' OR ${legacyCondition})`
			: legacyCondition;

	const incomeBql = `SELECT str(CONVERT(value(sum(position)), '${escapeBqlString(reportCurrency)}')) as income
        WHERE account ~ '^Income'
            AND date >= ${yieldFrom}
            AND ${matchCondition}`;

	const [valueResult, incomeResult] = await Promise.all([
		runQuery(queryFn, valueBql),
		runQuery(queryFn, incomeBql)
	]);

	const value = firstAmount(valueResult.rows);
	// Income accounts are credit-normal (negative); flip sign for display.
	const income = -1 * firstAmount(incomeResult.rows);

	const yieldValue = value === 0 ? 0 : (income * 100) / value;

	return {
		yieldPct: yieldValue.toFixed(2) + '%',
		income,
		value,
		matchedBy,
		linkedCurrencies: currencies
	};
}

export interface CommodityGainLossResult {
	costBasis: number;
	marketValue: number;
	gainLoss: number;
	gainLossPct: number;
	/** Formatted "N.NN <currency>, N.NN%", matching the legacy SecurityAnalyser.getGainLoss() shape. */
	summary: string;
	matchedBy: LinkStrategy;
	linkedCurrencies: string[];
}

/**
 * Unrealized cost basis vs. market value for a commodity, aggregated across
 * every currency code linked to it (same isin/ticker resolution as
 * computeCommodityYield). Extends the legacy single-`currency = symbol`
 * query to `currency IN (...)`.
 */
export async function computeCommodityGainLoss(
	queryFn: QueryFn,
	target: CommodityDirective,
	allCommodities: CommodityDirective[],
	reportCurrency: string
): Promise<CommodityGainLossResult> {
	const { currencies, matchedBy } = resolveLinkedCurrencies(target, allCommodities);
	const currencyList = currencies.map((c) => `'${escapeBqlString(c)}'`).join(', ');

	const bql = `SELECT
            str(convert(cost(sum(position)), '${escapeBqlString(reportCurrency)}')) AS cost_basis,
            str(convert(value(sum(position)), '${escapeBqlString(reportCurrency)}')) AS market_value
        WHERE currency IN (${currencyList})`;

	const { rows } = await runQuery(queryFn, bql);
	if (rows.length === 0) {
		return {
			costBasis: 0,
			marketValue: 0,
			gainLoss: 0,
			gainLossPct: 0,
			summary: 'n/a',
			matchedBy,
			linkedCurrencies: currencies
		};
	}
	if (rows.length > 1) {
		throw new UserError(
			`Multiple gain/loss records found for ${currencies.join(', ')}`,
			`Check your rledger data for duplicate entries for this symbol`,
			'This usually happens when the same symbol exists in multiple accounts without proper cost basis tracking'
		);
	}

	const row = rows[0] as string[];
	const costBasis = BeancountParser.getMoneyFromTupleString(row[0]).quantity;
	const marketValue = BeancountParser.getMoneyFromTupleString(row[1]).quantity;
	const gainLoss = marketValue - costBasis;
	const gainLossPct = costBasis === 0 ? 0 : (gainLoss / costBasis) * 100;

	return {
		costBasis,
		marketValue,
		gainLoss,
		gainLossPct,
		summary: `${gainLoss.toFixed(2)} ${reportCurrency}, ${gainLossPct.toFixed(2)}%`,
		matchedBy,
		linkedCurrencies: currencies
	};
}
