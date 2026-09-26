/*
    Integration: qqrl command -> parser -> BQL builder -> real ledger engine
    (WASM) over the demo book. The string-level tests elsewhere pin the query
    text; these prove the queries are valid and return sensible data.
*/
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureInitialized, queryMultiFile } from '$lib/services/rustledger';
import { buildQuery } from '$lib/services/quickQueryBuilder';
import { parseQqrlCommand } from '$lib/services/quickQueryCliParser';
import { demoFixtures } from '../helpers/demoFixtures';

function run(commandLine: string) {
	const parsed = parseQqrlCommand(commandLine);
	expect(parsed.errors).toEqual([]);
	expect(parsed.command).not.toBeNull();

	const bql = buildQuery(parsed.command!, parsed.commonOpts, parsed.lotsOpts);
	const result = queryMultiFile(demoFixtures, 'book.bean', bql);
	expect(result.errors, bql).toEqual([]);
	return result;
}

const firstColumn = (rows: unknown[][]) => rows.map((r) => r[0]);

beforeAll(async () => {
	await ensureInitialized();
});

describe('quick query against the demo book', () => {
	it('balance lists accounts matching the filter', () => {
		const { rows } = run('bal Expenses');

		const accounts = firstColumn(rows);
		expect(accounts).toContain('Expenses:Groceries');
		expect(accounts.every((a) => String(a).startsWith('Expenses'))).toBe(true);
	});

	it('balance honours "not" exclusions', () => {
		const accounts = firstColumn(run('bal Expenses not Rent').rows);

		expect(accounts).toContain('Expenses:Groceries');
		expect(accounts).not.toContain('Expenses:Rent');
	});

	it('balance --exchange adds a converted column', () => {
		expect(run('bal Assets:Investments -X EUR').columns).toContain('converted');
	});

	it('register lists postings, limited and sorted', () => {
		const { rows } = run('reg Groceries -S -date -l 2');

		expect(rows.length).toBeLessThanOrEqual(2);
		expect(rows.length).toBeGreaterThan(0);
	});

	it('register date range narrows results', () => {
		const all = run('reg Expenses').rows.length;
		const august = run('reg Expenses -d 2025-08').rows.length;

		expect(august).toBeGreaterThan(0);
		expect(august).toBeLessThan(all);
	});

	it('register @ filter matches on payee/narration', () => {
		const { rows } = run('reg @Supermarket');

		expect(rows.length).toBeGreaterThan(0);
	});

	it.each(['lots', 'lots --all', 'lots --closed', 'lots -A', 'lots -X EUR', 'lots -s symbol'])(
		'%s executes',
		(commandLine) => {
			run(commandLine);
		}
	);

	it('lots shows the demo securities', () => {
		const symbols = run('lots').rows.map((r) => JSON.stringify(r));

		expect(symbols.some((r) => r.includes('VTI'))).toBe(true);
	});

	it('price lists the demo price feed', () => {
		const { rows } = run('price VTI');

		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => String(r[1]).includes('VTI'))).toBe(true);
	});

	it('assert executes', () => {
		run('assert');
	});
});
