/**
 * Golden-file helpers for importer tests.
 *
 * Expected output is kept as Beancount text (`*.xml.beancount` next to the input), as in the
 * Python importers it was ported from. Both sides are reduced to the same canonical strings so
 * formatting (alignment, trailing zeros, comments) never decides a comparison:
 *
 * - `parseExpected` reads the small Beancount subset those files use.
 * - `canonicalize` renders imported `Xact`s the same way.
 *
 * Numbers are compared exactly (as JS numbers parsed from the same decimal text), not rounded.
 * Entries are compared in sorted order; postings keep their order.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Xact } from '../../src/lib/data/model';

export const IBKR_FIXTURES = path.resolve(import.meta.dirname, '..', 'data', 'ibkr');

export function readFixture(name: string): string {
	return readFileSync(path.join(IBKR_FIXTURES, name), 'utf-8');
}

/** The expected output for the input file `name` (e.g. `div-tax.xml`). */
export function readExpected(name: string): string[] {
	return parseExpected(readFixture(name + '.beancount'));
}

const num = (s: string) => String(Number(s));

const DIRECTIVE_RE = /^(\d{4}-\d{2}-\d{2}) +(\*|!|balance)(?= |$) *(.*)$/;
const POSTING_RE =
	/^\s+([A-Z][\w-]*(?::[\w-]+)+)(?:\s+(-?[\d.]+)\s+([A-Z][A-Z0-9'._-]*))?(?:\s+\{([^}]*)\})?(?:\s+(@@?)\s+(-?[\d.]+)\s+([A-Z][A-Z0-9'._-]*))?\s*$/;
const META_RE = /^(\s+)([a-z][\w-]*):\s*(.*)$/;

function formatCost(spec: string): string {
	// `{71.99 AUD}`, `{16.935 USD, 2025-06-09}` or `{2025-06-09}`
	const parts = spec.split(',').map((s) => s.trim());
	return (
		'{' +
		parts.map((p) => (/^-?[\d.]+ /.test(p) ? num(p.split(' ')[0]) + ' ' + p.split(' ')[1] : p)).join(', ') +
		'}'
	);
}

/** Canonical text of every directive in a Beancount file, sorted. */
export function parseExpected(text: string): string[] {
	const entries: { head: string; lines: string[] }[] = [];
	let current: { head: string; lines: string[] } | undefined;

	for (const raw of text.split(/\r?\n/)) {
		if (raw.trim() === '' || raw.trimStart().startsWith(';')) continue;

		const d = DIRECTIVE_RE.exec(raw);
		if (d) {
			const [, date, kind, rest] = d;
			if (kind === 'balance') {
				const m = /^(\S+)\s+(-?[\d.]+)\s+(\S+)$/.exec(rest.trim());
				if (!m) throw new Error(`Cannot parse balance: ${raw}`);
				entries.push({ head: `${date} balance ${m[1]} ${num(m[2])} ${m[3]}`, lines: [] });
				current = undefined;
			} else {
				const strings = [...rest.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((s) => s[1]);
				current = {
					head: `${date} ${kind} ${JSON.stringify(strings[0] ?? '')} ${JSON.stringify(strings[1] ?? '')}`,
					lines: []
				};
				entries.push(current);
			}
			continue;
		}

		if (!current) throw new Error(`Unexpected line outside a transaction: ${raw}`);

		const p = POSTING_RE.exec(raw);
		if (p) {
			const [, account, amount, currency, cost, priceKind, price, priceCurrency] = p;
			let line = '  ' + account;
			if (amount !== undefined) line += ` ${num(amount)} ${currency}`;
			if (cost !== undefined) line += ' ' + formatCost(cost);
			if (priceKind) line += ` ${priceKind} ${num(price)} ${priceCurrency}`;
			current.lines.push(line);
			continue;
		}

		const m = META_RE.exec(raw);
		if (m) {
			// Deeper indent than a posting line (4 spaces) belongs to the posting before it.
			current.lines.push((m[1].length >= 4 ? '    ' : '  ') + `${m[2]}: ${m[3].trim()}`);
			continue;
		}
		throw new Error(`Cannot parse line: ${raw}`);
	}

	return entries.map((e) => [e.head, ...e.lines].join('\n')).sort();
}

/** Canonical text of imported transactions, in the same form as `parseExpected`. */
export function canonicalize(xacts: Xact[]): string[] {
	return xacts
		.map((x) => {
			if (x.balanceAssertion) {
				const b = x.balanceAssertion;
				return `${x.date} balance ${b.account} ${num(String(b.amount))} ${b.currency}`;
			}
			const head = `${x.date} ${x.flag ?? '*'} ${JSON.stringify(x.payee ?? '')} ${JSON.stringify(x.note ?? '')}`;
			const lines: string[] = Object.entries(x.meta).map(([k, v]) => `  ${k}: ${v}`);
			for (const p of x.postings) {
				let line = '  ' + p.account;
				if (p.amount !== undefined) line += ` ${num(String(p.amount))} ${p.currency}`;
				if (p.costAmount !== undefined || p.costDate) {
					const parts: string[] = [];
					if (p.costAmount !== undefined) parts.push(`${num(String(p.costAmount))} ${p.costCurrency}`);
					if (p.costDate) parts.push(p.costDate);
					line += ` {${parts.join(', ')}}`;
				}
				if (p.priceAmount !== undefined) {
					line += ` ${p.totalPrice ? '@@' : '@'} ${num(String(p.priceAmount))} ${p.priceCurrency}`;
				}
				lines.push(line);
				// Posting metadata, if the model carries it (see the plan: not decided yet).
				const meta = (p as { meta?: Record<string, string> }).meta;
				for (const [k, v] of Object.entries(meta ?? {})) lines.push(`    ${k}: ${v}`);
			}
			return [head, ...lines].join('\n');
		})
		.sort();
}
