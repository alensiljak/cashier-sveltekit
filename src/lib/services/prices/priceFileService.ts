/**
 * Formats and merges price directives for the Price Download feature
 * (doc/projects/2026-11-15_price-download.md).
 *
 * The output is fully deterministic — fixed directive order, fixed number
 * formatting — so two devices that fetch the same fixing write byte-identical
 * files and the S3/WebDAV per-file sync sees "equivalent" and transfers
 * nothing. In append mode every existing line passes through verbatim except
 * a price line whose key is re-downloaded with a different rate.
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
 * Trailing comments are tolerated when parsing.
 */
const PRICE_LINE = new RegExp(
	`^\\s*(\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01]))\\s+price\\s+("[^"]*"|\\S+)\\s+([\\d.,]+)\\s+("[^"]*"|\\S+)\\s*(?:;.*)?$`
);

/** Deterministic rate rendering: at most 6 decimals, trailing zeros trimmed. */
export function formatRate(rate: number): string {
	if (!Number.isFinite(rate) || rate <= 0) {
		throw new Error(`Cannot format non-positive rate: ${rate}`);
	}
	const fixed = rate.toFixed(6);
	const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
	if (trimmed === '0') {
		throw new Error(`Rate ${rate} is too small to render at 6 decimals`);
	}
	return trimmed;
}

export function parsePriceLine(line: string): PriceDirective | null {
	const m = PRICE_LINE.exec(line);
	if (!m) return null;
	const base = m[2].replace(/^"|"$/g, '');
	const quote = m[4].replace(/^"|"$/g, '');
	const rate = Number(m[3].replace(/,/g, ''));
	// A non-positive rate is not a valid price: treat the line as foreign so
	// it passes through untouched instead of crashing the renderer.
	if (!Number.isFinite(rate) || rate <= 0) return null;
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
		.sort((a, b) => {
			if (a.date !== b.date) return a.date < b.date ? -1 : 1;
			const pa = `${a.base}/${a.quote}`;
			const pb = `${b.base}/${b.quote}`;
			return pa === pb ? 0 : pa < pb ? -1 : 1;
		})
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
 * Append mode: merge in place. Every existing line passes through byte for
 * byte (user directives, comments, quoting, precision) except a price line
 * whose `date|base|quote` key is in `incoming` *and* carries a different
 * rate — that one line is replaced by the incoming value (a corrected fixing
 * converges on every device). Keys not yet in the file are appended, sorted,
 * at the end. Line endings of the existing file are kept.
 */
export function mergePriceFile(existing: string, incoming: PriceDirective[]): MergeResult {
	const eol = existing.includes('\r\n') ? '\r\n' : '\n';
	const lines = existing.split(/\r?\n/);
	// A file ending in a newline splits to a trailing ''; the final newline is
	// re-added below.
	if (lines[lines.length - 1] === '') lines.pop();

	const pending = new Map<string, PriceDirective>();
	for (const d of incoming) pending.set(priceKey(d), d);

	const seen = new Set<string>();
	let updated = 0;
	for (let i = 0; i < lines.length; i++) {
		const parsed = parsePriceLine(lines[i]);
		if (!parsed) continue;
		const key = priceKey(parsed);
		const wanted = pending.get(key);
		if (!wanted) continue;
		if (formatRate(parsed.rate) !== formatRate(wanted.rate)) {
			lines[i] = renderDirectives([wanted])[0];
			if (!seen.has(key)) updated++;
		}
		seen.add(key);
	}

	const fresh = [...pending].filter(([key]) => !seen.has(key)).map(([, d]) => d);
	lines.push(...renderDirectives(fresh));
	return { text: lines.join(eol) + eol, added: fresh.length, updated };
}
