/**
 * Portfolio Returns cash-flow extraction.
 *
 * For a set of investment groups, builds each group's dated cash-flow series (external
 * contributions and withdrawals) plus synthetic opening/closing market-value flows, ready for
 * `xirr()`.
 *
 * Classification (see doc/projects/portfolio-returns.md, "Flow classification"):
 * - A posting on a group's own accounts is internal (already reflected in market value).
 * - Postings to Income:/Expenses: accounts are never external flows (dividends, interest,
 *   fees are folded into market value, matching beangrow).
 * - Everything else — including a shared broker cash account funding buys/sells across
 *   multiple symbols — is external. A buy/sell against shared cash therefore carries the
 *   full flow amount at the moment cash converts into (or out of) this specific holding;
 *   cash sitting uninvested in a broker account is correctly invisible until then, since it
 *   isn't attributable to any one group.
 *
 * Currency conversion is delegated to the WASM engine's `convert()`. Per beancount semantics
 * it returns the amount *unconverted* (in its original currency) when no price path exists,
 * rather than erroring — so every converted amount's returned currency is checked against the
 * report currency, and mismatches are surfaced as warnings rather than silently fed into the
 * NPV as if they were report-currency amounts.
 *
 * Split into two independent phases so a caller (e.g. the report UI) can render each as it
 * lands instead of blocking on everything:
 * - `marketValuesForGroups` — 2 queries (opening/closing date points), batched across every
 *   group via `GROUP BY account`.
 * - `transactionFlowsForGroups` — 2 queries (id-discovery, then postings for those ids),
 *   likewise batched across every group.
 * Each phase is itself O(1) in the number of groups — not once per group. Querying per group
 * instead (4 × group count) is fine for a handful of groups but doesn't scale to a deep
 * multi-level asset-class tree with dozens of leaf groups — each full-ledger BQL scan is
 * O(ledger size), so per-group querying was O(groups × ledger size) against a single-threaded
 * WASM worker. `extractAllGroupFlows` (blocking on both phases) and `extractGroupFlows`
 * (single group) are convenience wrappers for callers that don't need to stream.
 */

import type { Money } from '$lib/data/model';
import * as BeancountParser from '$lib/utils/beancountParser';
import type { CashFlow } from '$lib/utils/xirr';
import type { InvestmentGroup } from './investmentGroups';

export type QueryFn = (
	bql: string
) => Promise<{ columns: string[]; rows: unknown[][]; errors: unknown[] }>;

export interface GroupMarketValue {
	/** Market value the day before `startDate` (0 if the group didn't exist yet), converted
	 *  to the report currency. */
	openingValue: number;
	/** Market value through `endDate`, converted to the report currency. */
	closingValue: number;
	conversionWarnings: string[];
}

export interface GroupTransactionFlows {
	/** External transaction flows only — no synthetic opening/closing entries. */
	flows: CashFlow[];
	conversionWarnings: string[];
}

export interface GroupFlowsResult {
	/** Transaction flows plus synthetic opening/closing entries, sorted by date. */
	flows: CashFlow[];
	openingValue: number;
	closingValue: number;
	/** e.g. "VXUS: no price to EUR (got USD)" — one entry per commodity that couldn't be
	 *  converted to the report currency. The affected amount is still included in `flows`,
	 *  unconverted — callers must not treat the result as report-currency-clean when this is
	 *  non-empty. */
	conversionWarnings: string[];
}

const EPSILON = 1e-6;

/** Escapes a value for embedding in a single-quoted BQL string literal. */
function escapeBqlString(value: string): string {
	return value.replace(/'/g, "''");
}

function quoteList(values: string[]): string {
	return values.map((v) => `'${escapeBqlString(v)}'`).join(', ');
}

/** `id` is a numeric BQL column, not a string — quoting it (like every other filter in this
 *  module) silently matches nothing. Bare-emit numeric ids; quote anything unexpectedly
 *  non-numeric rather than assume the column type. */
function idList(ids: string[]): string {
	return ids.map((id) => (/^-?\d+$/.test(id) ? id : `'${escapeBqlString(id)}'`)).join(', ');
}

function isIncomeOrExpense(account: string): boolean {
	return account.startsWith('Income:') || account.startsWith('Expenses:');
}

function isExternal(account: string, accountNames: Set<string>): boolean {
	return !accountNames.has(account) && !isIncomeOrExpense(account);
}

async function runQuery(
	queryFn: QueryFn,
	bql: string
): Promise<{ columns: string[]; rows: unknown[][] }> {
	const result = await queryFn(bql);
	if (result.errors.length > 0) {
		const messages = result.errors.map((e) =>
			e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
		);
		throw new Error(`BQL query failed: ${messages.join('; ')}`);
	}
	return { columns: result.columns, rows: result.rows };
}

/** Parses a 'YYYY-MM-DD' string as a local-midnight Date, matching xirr.ts's day-diff math. */
function parseDate(dateStr: string): Date {
	const [year, month, day] = dateStr.split('-').map(Number);
	return new Date(year, month - 1, day);
}

function shiftDate(dateStr: string, days: number): string {
	const date = parseDate(dateStr);
	date.setDate(date.getDate() + days);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function allAccountNames(groups: InvestmentGroup[]): string[] {
	return groups.flatMap((group) => group.accounts.map((a) => a.name));
}

/**
 * Market value of every account in `accountNames` at end-of-day `asOf` (inclusive), converted
 * to `reportCurrency`, keyed by account. One query for however many accounts are passed.
 */
async function marketValueByAccount(
	queryFn: QueryFn,
	accountNames: string[],
	asOf: string,
	reportCurrency: string
): Promise<Map<string, Money>> {
	const bql = `SELECT account, str(convert(value(sum(position)), '${escapeBqlString(reportCurrency)}')) as value
        WHERE account IN (${quoteList(accountNames)}) AND date <= ${asOf}
        GROUP BY account`;
	const { columns, rows } = await runQuery(queryFn, bql);
	const accountIdx = columns.indexOf('account');
	const valueIdx = columns.indexOf('value');
	const result = new Map<string, Money>();
	for (const row of rows) {
		if (row[valueIdx] == null) continue;
		result.set(
			String(row[accountIdx]),
			BeancountParser.getMoneyFromTupleString(String(row[valueIdx]))
		);
	}
	return result;
}

/**
 * Opening/closing market value for every group, batched into 2 queries total (not per group).
 */
export async function marketValuesForGroups(
	queryFn: QueryFn,
	groups: InvestmentGroup[],
	reportCurrency: string,
	startDate: string,
	endDate: string
): Promise<Map<string, GroupMarketValue>> {
	const results = new Map<string, GroupMarketValue>();
	for (const group of groups) {
		results.set(group.name, { openingValue: 0, closingValue: 0, conversionWarnings: [] });
	}
	const accountNames = allAccountNames(groups);
	if (accountNames.length === 0) return results;

	const [openingByAccount, closingByAccount] = await Promise.all([
		marketValueByAccount(queryFn, accountNames, shiftDate(startDate, -1), reportCurrency),
		marketValueByAccount(queryFn, accountNames, endDate, reportCurrency)
	]);

	for (const group of groups) {
		const result = results.get(group.name)!;
		const warnings = new Set<string>();
		for (const account of group.accounts) {
			const opening = openingByAccount.get(account.name);
			if (opening) {
				result.openingValue += opening.quantity;
				if (opening.quantity !== 0 && opening.currency !== reportCurrency) {
					warnings.add(
						`${group.symbols.join('/')}: no price to ${reportCurrency} (got ${opening.currency})`
					);
				}
			}
			const closing = closingByAccount.get(account.name);
			if (closing) {
				result.closingValue += closing.quantity;
				if (closing.quantity !== 0 && closing.currency !== reportCurrency) {
					warnings.add(
						`${group.symbols.join('/')}: no price to ${reportCurrency} (got ${closing.currency})`
					);
				}
			}
		}
		result.conversionWarnings = Array.from(warnings);
	}
	return results;
}

/**
 * External transaction flows for every group inside [startDate, endDate], batched into 2
 * queries total (not per group). No synthetic opening/closing entries — see
 * `marketValuesForGroups` / `buildFullFlowSeries` for those.
 */
export async function transactionFlowsForGroups(
	queryFn: QueryFn,
	groups: InvestmentGroup[],
	reportCurrency: string,
	startDate: string,
	endDate: string
): Promise<Map<string, GroupTransactionFlows>> {
	const results = new Map<string, GroupTransactionFlows>();
	const accountToGroup = new Map<string, InvestmentGroup>();
	for (const group of groups) {
		results.set(group.name, { flows: [], conversionWarnings: [] });
		for (const account of group.accounts) accountToGroup.set(account.name, group);
	}
	const accountNames = allAccountNames(groups);
	if (accountNames.length === 0) return results;

	// One id-discovery query across every group's accounts. A transaction can touch more
	// than one group (e.g. a rebalance) — record it against every group it touches.
	const idsBql = `SELECT id, account
        WHERE account IN (${quoteList(accountNames)}) AND date >= ${startDate} AND date <= ${endDate}`;
	const { rows: idRows } = await runQuery(queryFn, idsBql);
	const idsByGroup = new Map<string, Set<string>>();
	const allIds = new Set<string>();
	for (const row of idRows) {
		const group = accountToGroup.get(String(row[1]));
		if (!group) continue;
		const id = String(row[0]);
		allIds.add(id);
		let ids = idsByGroup.get(group.name);
		if (!ids) {
			ids = new Set();
			idsByGroup.set(group.name, ids);
		}
		ids.add(id);
	}
	if (allIds.size === 0) return results;

	const postingsBql = `SELECT id, date, account, currency, str(convert(position, '${escapeBqlString(reportCurrency)}')) as converted
        WHERE id IN (${idList(Array.from(allIds))})
        ORDER BY date`;
	const { columns, rows } = await runQuery(queryFn, postingsBql);
	const idIdx = columns.indexOf('id');
	const dateIdx = columns.indexOf('date');
	const accountIdx = columns.indexOf('account');
	const currencyIdx = columns.indexOf('currency');
	const convertedIdx = columns.indexOf('converted');

	interface Leg {
		date: string;
		account: string;
		currency: string;
		converted: string;
	}
	const legsById = new Map<string, Leg[]>();
	for (const row of rows) {
		const id = String(row[idIdx]);
		const leg: Leg = {
			date: String(row[dateIdx]),
			account: String(row[accountIdx]),
			currency: String(row[currencyIdx]),
			converted: String(row[convertedIdx])
		};
		const legs = legsById.get(id);
		if (legs) legs.push(leg);
		else legsById.set(id, [leg]);
	}

	for (const group of groups) {
		const groupIds = idsByGroup.get(group.name);
		if (!groupIds) continue;
		const accountNames = new Set(group.accounts.map((a) => a.name));
		const result = results.get(group.name)!;
		const warnings = new Set<string>();

		for (const id of groupIds) {
			let total = 0;
			let date = '';
			for (const leg of legsById.get(id) ?? []) {
				if (!isExternal(leg.account, accountNames)) continue;
				date = leg.date;
				const money = BeancountParser.getMoneyFromTupleString(leg.converted);
				if (money.currency !== reportCurrency) {
					warnings.add(`${leg.currency}: no price to ${reportCurrency}`);
				}
				total += money.quantity;
			}
			if (Math.abs(total) > EPSILON) {
				result.flows.push({ date: parseDate(date), amount: total });
			}
		}
		result.conversionWarnings = Array.from(warnings);
	}

	return results;
}

/**
 * Combines a group's external transaction flows with its synthetic opening/closing
 * market-value flows into one sorted series, ready for `xirr()`. Pure and synchronous — the
 * report UI calls this once both `marketValuesForGroups` and `transactionFlowsForGroups` have
 * resolved for a given group, however each arrived.
 */
export function buildFullFlowSeries(
	transactionFlows: CashFlow[],
	openingValue: number,
	closingValue: number,
	startDate: string,
	endDate: string
): CashFlow[] {
	const flows = [...transactionFlows];
	if (Math.abs(openingValue) > EPSILON) {
		flows.push({ date: parseDate(startDate), amount: -openingValue });
	}
	if (Math.abs(closingValue) > EPSILON) {
		flows.push({ date: parseDate(endDate), amount: closingValue });
	}
	flows.sort((a, b) => a.date.getTime() - b.date.getTime());
	return flows;
}

function emptyResult(): GroupFlowsResult {
	return { flows: [], openingValue: 0, closingValue: 0, conversionWarnings: [] };
}

/**
 * Extracts every group's full cash-flow series (synthetic opening/closing flows + external
 * transaction flows) for the [startDate, endDate] window, blocking on both BQL phases. Callers
 * that want to render each phase as it lands should call `marketValuesForGroups` and
 * `transactionFlowsForGroups` directly instead (see module docs).
 */
export async function extractAllGroupFlows(
	queryFn: QueryFn,
	groups: InvestmentGroup[],
	reportCurrency: string,
	startDate: string,
	endDate: string
): Promise<Map<string, GroupFlowsResult>> {
	const [marketValues, transactionFlows] = await Promise.all([
		marketValuesForGroups(queryFn, groups, reportCurrency, startDate, endDate),
		transactionFlowsForGroups(queryFn, groups, reportCurrency, startDate, endDate)
	]);

	const results = new Map<string, GroupFlowsResult>();
	for (const group of groups) {
		const mv = marketValues.get(group.name);
		const tf = transactionFlows.get(group.name);
		if (!mv || !tf) {
			results.set(group.name, emptyResult());
			continue;
		}
		results.set(group.name, {
			flows: buildFullFlowSeries(tf.flows, mv.openingValue, mv.closingValue, startDate, endDate),
			openingValue: mv.openingValue,
			closingValue: mv.closingValue,
			conversionWarnings: [...mv.conversionWarnings, ...tf.conversionWarnings]
		});
	}
	return results;
}

/** Single-group convenience wrapper around {@link extractAllGroupFlows}. */
export async function extractGroupFlows(
	queryFn: QueryFn,
	group: InvestmentGroup,
	reportCurrency: string,
	startDate: string,
	endDate: string
): Promise<GroupFlowsResult> {
	const results = await extractAllGroupFlows(queryFn, [group], reportCurrency, startDate, endDate);
	return results.get(group.name) ?? emptyResult();
}
