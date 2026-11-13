/**
 * Reader for the Interactive Brokers Flex Query XML report.
 *
 * It only turns the XML into typed records. Every value stays text (amounts are never parsed
 * into floats here), and empty attributes are treated as absent. What the records mean for the
 * book is decided by the importer.
 *
 * Uses `DOMParser`, so it runs on the main thread (and in jsdom tests), not inside a Worker.
 */

type Attrs<R extends string, O extends string> = Record<R, string> & Partial<Record<O, string>>;

/** Reads the listed attributes of an element. Required ones must be present and non-empty. */
function read<R extends string, O extends string>(
	el: Element,
	required: readonly R[],
	optional: readonly O[]
): Attrs<R, O> {
	const out: Record<string, string> = {};
	for (const name of required) {
		const value = el.getAttribute(name);
		if (!value) throw new Error(`<${el.tagName}> is missing the "${name}" attribute`);
		out[name] = value;
	}
	for (const name of optional) {
		const value = el.getAttribute(name);
		if (value) out[name] = value;
	}
	return out as Attrs<R, O>;
}

const CASH_TRANSACTION_REQUIRED = ['type', 'currency', 'amount', 'reportDate'] as const;
const CASH_TRANSACTION_OPTIONAL = ['symbol', 'isin', 'dateTime', 'description'] as const;
export type CashTransactionRow = Attrs<
	(typeof CASH_TRANSACTION_REQUIRED)[number],
	(typeof CASH_TRANSACTION_OPTIONAL)[number]
>;

const TRADE_REQUIRED = ['symbol', 'currency', 'dateTime', 'buySell', 'quantity'] as const;
const TRADE_OPTIONAL = [
	'isin',
	'transactionType',
	'openCloseIndicator',
	'tradeDate',
	'reportDate',
	'tradePrice',
	'proceeds',
	'netCash',
	'ibCommission',
	'ibCommissionCurrency',
	'taxes'
] as const;
export type TradeRow = Attrs<(typeof TRADE_REQUIRED)[number], (typeof TRADE_OPTIONAL)[number]> & {
	/** The `<Lot>` rows that follow this trade (the lots closed by a sale). */
	lots: LotRow[];
};

const LOT_REQUIRED = ['symbol', 'quantity'] as const;
const LOT_OPTIONAL = ['isin', 'currency', 'openDateTime', 'cost', 'dateTime', 'buySell'] as const;
export type LotRow = Attrs<(typeof LOT_REQUIRED)[number], (typeof LOT_OPTIONAL)[number]>;

const POSITION_REQUIRED = ['symbol', 'position'] as const;
const POSITION_OPTIONAL = ['isin'] as const;
export type OpenPositionRow = Attrs<
	(typeof POSITION_REQUIRED)[number],
	(typeof POSITION_OPTIONAL)[number]
>;

const CASH_REPORT_REQUIRED = ['currency', 'endingCash', 'toDate'] as const;
export type CashReportRow = Attrs<(typeof CASH_REPORT_REQUIRED)[number], never>;

const CORPORATE_ACTION_REQUIRED = ['type', 'reportDate'] as const;
const CORPORATE_ACTION_OPTIONAL = ['symbol', 'isin', 'description', 'dateTime'] as const;
export type CorporateActionRow = Attrs<
	(typeof CORPORATE_ACTION_REQUIRED)[number],
	(typeof CORPORATE_ACTION_OPTIONAL)[number]
>;

export interface FlexStatement {
	accountId: string;
	fromDate: string;
	toDate: string;
	whenGenerated: string;
	cashReport: CashReportRow[];
	openPositions: OpenPositionRow[];
	trades: TradeRow[];
	cashTransactions: CashTransactionRow[];
	corporateActions: CorporateActionRow[];
}

const children = (parent: Element | null, tag: string): Element[] =>
	parent ? [...parent.children].filter((c) => c.tagName === tag) : [];

function section(statement: Element, name: string): Element | null {
	return children(statement, name)[0] ?? null;
}

function readTrades(el: Element | null): TradeRow[] {
	const trades: TradeRow[] = [];
	for (const child of el?.children ?? []) {
		if (child.tagName === 'Trade') {
			trades.push({ ...read(child, TRADE_REQUIRED, TRADE_OPTIONAL), lots: [] });
		} else if (child.tagName === 'Lot') {
			const trade = trades[trades.length - 1];
			if (!trade) throw new Error('A <Lot> row comes before any <Trade>');
			trade.lots.push(read(child, LOT_REQUIRED, LOT_OPTIONAL));
		} else {
			throw new Error(`Unknown element <${child.tagName}> in <Trades>`);
		}
	}
	return trades;
}

/** Whether the text looks like a Flex Query report. */
export function isFlexQuery(text: string): boolean {
	return text.includes('<FlexQueryResponse ');
}

/** Parses the report; one entry per `<FlexStatement>`. Throws on malformed input. */
export function parseFlexQuery(xml: string): FlexStatement[] {
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	if (doc.getElementsByTagName('parsererror').length > 0) {
		throw new Error('The file is not valid XML');
	}
	const root = doc.documentElement;
	if (root.tagName !== 'FlexQueryResponse') {
		throw new Error(`Not a Flex Query report: the root element is <${root.tagName}>`);
	}

	return children(children(root, 'FlexStatements')[0] ?? null, 'FlexStatement').map((el) => {
		const attrs = read(el, ['accountId', 'fromDate', 'toDate', 'whenGenerated'] as const, []);
		const rows = <R extends string, O extends string>(
			name: string,
			tag: string,
			required: readonly R[],
			optional: readonly O[]
		) => children(section(el, name), tag).map((c) => read(c, required, optional));

		return {
			...attrs,
			cashReport: rows('CashReport', 'CashReportCurrency', CASH_REPORT_REQUIRED, []),
			openPositions: rows('OpenPositions', 'OpenPosition', POSITION_REQUIRED, POSITION_OPTIONAL),
			trades: readTrades(section(el, 'Trades')),
			cashTransactions: rows(
				'CashTransactions',
				'CashTransaction',
				CASH_TRANSACTION_REQUIRED,
				CASH_TRANSACTION_OPTIONAL
			),
			corporateActions: rows(
				'CorporateActions',
				'CorporateAction',
				CORPORATE_ACTION_REQUIRED,
				CORPORATE_ACTION_OPTIONAL
			)
		};
	});
}

/**
 * The date part (`yyyy-MM-dd`) of a report date or date-time (`2025-02-27 12:20:00`).
 * Other date formats are an error: set the Flex Query's date format to `yyyy-MM-dd`.
 */
export function isoDate(value: string): string {
	const date = value.slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
		throw new Error(`Unsupported date "${value}". Set the Flex Query date format to yyyy-MM-dd.`);
	}
	return date;
}

/** `yyyy-MM-dd` plus a number of days. */
export function addDays(date: string, days: number): string {
	const d = new Date(Date.parse(isoDate(date)));
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}
