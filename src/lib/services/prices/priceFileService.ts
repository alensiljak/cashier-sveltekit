/**
 * Formats and merges price directives for the Price Download feature
 * (doc/projects/2026-11-15_price-download.md).
 *
 * The output is fully deterministic — fixed directive order, fixed number
 * formatting — so two devices that fetch the same fixing write byte-identical
 * files and the S3/WebDAV per-file sync sees "equivalent" and transfers
 * nothing. Anything else in the file (comments, the user's own directives)
 * counts as a foreign line and passes through verbatim in append mode.
 */

export interface PriceDirective {
	date: string;
	base: string;
	rate: number;
	quote: string;
}

export interface ParsedPriceFile {
	/** Directive lines, keyed by `date|base|quote`. */
	directives: Map<string, PriceDirective>;
	/** Every line that is not a `price` directive, verbatim, in order. */
	foreignLines: string[];
}

/**
 * A `price` directive line, e.g. `2026-11-13 price EUR 1.1052 USD`.
 * Trailing comments are tolerated when parsing (they are dropped when the
 * line is rewritten — the file is machine-managed).
 */
const ISO_DATE = /\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])/;
const PRICE_LINE = new RegExp(
	`^\\s*(\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01]))\\s+price\\s+("[^"]*"|\\S+)\\s+([\\d.,]+)\\s+("[^"]*"|\\S+)\\s*(?:;.*)?$`
);

/** True for calendar-valid ISO dates (rejects e.g. `2026-13-45`). */
export function isIsoDate(date: string): boolean {
	return ISO_DATE.test(date);
}

/** Deterministic rate rendering: at most 6 decimals, trailing zeros trimmed. */
export function formatRate(rate: number): string {
	if (!Number.isFinite(rate) || rate <= 0) {
		throw new Error(`Cannot format non-positive rate: ${rate}`);
	}
	const fixed = rate.toFixed(6);
	return fixed.replace(/0+$/, '').replace(/\.$/, '');
}

export function parsePriceLine(line: string): PriceDirective | null {
	const m = PRICE_LINE.exec(line);
	if (!m) return null;
	const base = m[2].replace(/^"|"$/g, '');
	const quote = m[4].replace(/^"|"$/g, '');
	const rate = Number(m[3].replace(/,/g, ''));
	if (!Number.isFinite(rate)) return null;
	return { date: m[1], base, rate, quote };
}

export function priceKey(d: { date: string; base: string; quote: string }): string {
	return `${d.date}|${d.base}|${d.quote}`;
}

/**
 * Turn fetched quotes into directives. Symbols in `inverted` are written in
 * the book's own series direction (`symbol → base`, rate inverted to
 * `1 / nativeRate`) so the download extends the user's existing series
 * instead of adding an opposite-direction series the engine would coalesce
 * away. Inversion determinism: `formatRate` caps at 6 decimals, so every
 * device renders the same inverted value.
 */
export function toDirectives(
	fetched: { asOf: string; quotes: Array<{ base: string; rate: number; quote: string }> },
	inverted: Iterable<string>,
	providerBase: string
): PriceDirective[] {
	const invertedSet = new Set(inverted);
	return fetched.quotes.map((q) =>
		invertedSet.has(q.quote)
			? { date: fetched.asOf, base: q.quote, rate: 1 / q.rate, quote: providerBase }
			: { date: fetched.asOf, base: q.base, rate: q.rate, quote: q.quote }
	);
}

export function parsePriceFile(text: string): ParsedPriceFile {
	const directives = new Map<string, PriceDirective>();
	const foreignLines: string[] = [];
	for (const line of text.split('\n')) {
		const directive = parsePriceLine(line);
		if (directive) directives.set(priceKey(directive), directive);
		else foreignLines.push(line);
	}
	return { directives, foreignLines };
}

/** Sorted, rendered directive lines: (date, base, quote), fixed formatting. */
export function renderDirectives(directives: Iterable<PriceDirective>): string[] {
	return [...directives]
		.sort((a, b) =>
			a.date < b.date
				? -1
				: a.date > b.date
					? 1
					: `${a.base}/${a.quote}` < `${b.base}/${b.quote}`
						? -1
						: 1
		)
		.map((d) => `${d.date} price ${d.base} ${formatRate(d.rate)} ${d.quote}`);
}

/**
 * Overwrite mode: the file is machine-managed — header comment plus exactly
 * the latest fixing's directives. Everything else in the file is dropped
 * (the page says so under the write-mode toggle).
 */
export function buildPriceFile(
	directives: PriceDirective[],
	sourceComment: string,
	fixingDate: string
): string {
	const lines = [
		`; ${sourceComment} — latest fixing: ${fixingDate}`,
		...renderDirectives(directives)
	];
	return lines.join('\n') + '\n';
}

export interface MergeResult {
	text: string;
	/** Keys added this run. */
	added: number;
	/** Keys whose rate changed this run. */
	updated: number;
}

/**
 * Append mode: foreign lines are preserved verbatim and in order; price
 * directives merge by `date|base|quote` with the incoming value winning on
 * collision (a corrected fixing converges on every device). All directive
 * lines are rewritten through the fixed formatter so the file converges to
 * canonical bytes.
 */
export function mergePriceFile(existing: string, incoming: PriceDirective[]): MergeResult {
	const parsed = parsePriceFile(existing);
	let added = 0;
	let updated = 0;
	for (const d of incoming) {
		const key = priceKey(d);
		const existingDirective = parsed.directives.get(key);
		if (!existingDirective) {
			added++;
		} else if (formatRate(existingDirective.rate) !== formatRate(d.rate)) {
			updated++;
		}
		parsed.directives.set(key, d);
	}

	// Foreign lines first (unchanged), a single blank line, then the canonical
	// directive block. The split of a file ending in '\n' leaves trailing ''
	// entries in the foreign lines — trim them; the final newline is appended
	// below.
	const foreign = [...parsed.foreignLines];
	while (foreign.length > 0 && foreign[foreign.length - 1] === '') foreign.pop();
	const rendered = renderDirectives(parsed.directives.values());
	const lines =
		foreign.length > 0 && rendered.length > 0
			? [...foreign, '', ...rendered]
			: [...foreign, ...rendered];
	return { text: lines.join('\n') + '\n', added, updated };
}
