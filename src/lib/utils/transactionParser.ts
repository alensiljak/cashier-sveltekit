/**
 * Xact parser
 * Used for calculation of the empty postings
 */
import { Posting, Xact } from '$lib/data/model';
import rustledger from '$lib/services/rustledger';

export class TransactionParser {
	/**
	 * Extract the postings for the given account from the list of Transactions
	 * @param accountName The name of the account
	 */
	static extractPostingsFor(txs: Xact[], accountName: string): Posting[] {
		let result: Posting[] = [];

		txs.forEach((tx) => {
			const postings = tx.postings.filter((posting) => posting.account == accountName);
			result = result.concat(postings);
		});
		return result;
	}
}

/**
 * Map a raw WASM transaction directive object to an Xact view model.
 * Works with directives from both ParsedLedger.getDirectives() and
 * parse(source).ledger.directives.
 *
 * Pass rawSource when available so @@ vs @ can be detected from the text —
 * the WASM Amount type has no `total` field and never sets it at runtime.
 */
export function directiveToXact(directive: any, rawSource?: string): Xact {
	const tx = new Xact();
	tx.date = directive.date;
	tx.payee = directive.payee ?? '';
	tx.note = directive.narration ?? '';
	tx.flag = directive.flag ?? '*';
	tx.meta = normalizeMeta(directive.meta);
	tx.postings = (directive.postings ?? []).map((p: any) => {
		const posting = new Posting();
		posting.account = p.account ?? '';
		if (p.units?.number != null) posting.amount = parseFloat(p.units.number);
		if (p.units?.currency) posting.currency = p.units.currency;
		if (p.price) {
			// getDirectives() from a booked ParsedLedger silently rewrites a `@@ total`
			// annotation into its equivalent `@ per-unit` price (and never sets
			// p.price.total), which would otherwise redisplay the user's total-price
			// entry as an unrecognizable per-unit number. Recover the annotation the
			// user actually typed by re-reading it from the raw source line instead.
			const sourcePrice = extractPriceFromSource(rawSource, p.account);
			if (sourcePrice) {
				posting.priceAmount = sourcePrice.priceAmount;
				posting.priceCurrency = sourcePrice.priceCurrency;
				posting.totalPrice = sourcePrice.totalPrice;
			} else {
				if (p.price.number != null) posting.priceAmount = parseFloat(p.price.number);
				if (p.price.currency) posting.priceCurrency = p.price.currency;
				posting.totalPrice = !!p.price.total;
			}
		}
		if (p.cost?.number != null) posting.costAmount = extractCostNumber(p.cost.number);
		if (p.cost?.currency) posting.costCurrency = p.cost.currency;
		if (p.cost?.date) posting.costDate = p.cost.date;
		return posting;
	});
	return tx;
}

/**
 * Extract a numeric value from a CostNumberJson tagged union.
 * The WASM type is { kind: "per_unit"|"total", value: string }
 * or { kind: "compound"|"per_unit_from_total", per_unit: string, total: string }.
 * Falls back to treating the argument as a plain string for forward-compat.
 */
function extractCostNumber(num: any): number | undefined {
	if (num == null) return undefined;
	if (typeof num === 'string') return parseFloat(num);
	if (typeof num === 'object') {
		const raw: string | undefined = num.value ?? num.per_unit;
		return raw != null ? parseFloat(raw) : undefined;
	}
	return undefined;
}

/**
 * Re-reads a posting's price annotation (`@ amount currency` or `@@ amount currency`)
 * directly from the raw source line for `account`, so the original entry survives
 * even when the parsed directive's price has been normalized (e.g. to per-unit by
 * ledger booking). Matches the posting line by first token to avoid substring
 * collisions between account names.
 */
function extractPriceFromSource(
	source: string | undefined,
	account: string
): { priceAmount: number; priceCurrency: string; totalPrice: boolean } | undefined {
	if (!source || !account) return undefined;
	for (const line of source.split('\n')) {
		const trimmed = line.trimStart();
		if (trimmed.split(/\s+/)[0] !== account) continue;
		const match = trimmed.match(
			/@(@)?\s*([-+]?[0-9][0-9,]*(?:\.[0-9]+)?)\s+([A-Za-z][A-Za-z0-9'._-]*)/
		);
		if (!match) continue;
		return {
			totalPrice: !!match[1],
			priceAmount: parseFloat(match[2].replace(/,/g, '')),
			priceCurrency: match[3]
		};
	}
	return undefined;
}

/**
 * Convert a raw WASM `meta` object (string | boolean | {number,currency} | null values)
 * down to a plain string map for editing. Non-string values are coerced for display;
 * boolean/amount-shaped meta round-trips as a quoted string on save (acceptable for the
 * xact-level metadata editor, which only targets simple string tags like `isin`).
 */
function normalizeMeta(meta: unknown): Record<string, string> {
	if (!meta || typeof meta !== 'object') return {};
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
		result[key] = metaValueToString(value);
	}
	return result;
}

function metaValueToString(value: unknown): string {
	if (typeof value === 'string') return value;
	if (value == null) return '';
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

export function parseXact(input: string): Xact {
	if (!input) {
		throw new Error('Missing input');
	}

	const result = rustledger.parseSource(input);
	const directive = (result.ledger as any)?.directives?.find((d: any) => d.type === 'transaction');

	if (!directive) {
		throw new Error('No transaction found in input');
	}

	return directiveToXact(directive, input);
}
