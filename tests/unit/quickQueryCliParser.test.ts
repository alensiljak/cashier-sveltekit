/*
    Tests for the qqrl-style command-line parser used by the Quick Query page.
*/
import { describe, expect, it } from 'vitest';
import { parseQqrlCommand } from '$lib/services/quickQueryCliParser';

describe('commands', () => {
	it.each([
		['balance', 'balance'],
		['bal', 'balance'],
		['b', 'balance'],
		['register', 'register'],
		['reg', 'register'],
		['r', 'register'],
		['lots', 'lots'],
		['lot', 'lots'],
		['l', 'lots'],
		['assert', 'assert'],
		['a', 'assert'],
		['price', 'price'],
		['p', 'price']
	])('resolves alias %s to %s', (alias, command) => {
		const result = parseQqrlCommand(alias);

		expect(result.command).toBe(command);
		expect(result.errors).toEqual([]);
	});

	it('is case-insensitive for the command word', () => {
		expect(parseQqrlCommand('BAL').command).toBe('balance');
	});

	it('returns no command and no errors for empty input', () => {
		expect(parseQqrlCommand('   ')).toMatchObject({ command: null, errors: [] });
	});

	it('rejects unknown commands', () => {
		const result = parseQqrlCommand('frobnicate');

		expect(result.command).toBeNull();
		expect(result.errors).toEqual(["Unknown command 'frobnicate'"]);
	});

	it.each(['query', 'q'])('rejects the unsupported %s command', (word) => {
		const result = parseQqrlCommand(`${word} SELECT 1`);

		expect(result.command).toBeNull();
		expect(result.errors).toEqual(['The query command is not supported in this UI']);
	});
});

describe('common options (balance, register, assert, price)', () => {
	it('collects positional tokens as account patterns', () => {
		const { commonOpts } = parseQqrlCommand('bal Assets Expenses:Food');

		expect(commonOpts.account).toEqual(['Assets', 'Expenses:Food']);
	});

	it('has sensible defaults', () => {
		const { commonOpts } = parseQqrlCommand('bal');

		expect(commonOpts).toEqual({
			account: [],
			currency: [],
			total: false,
			hierarchy: false,
			zero: false,
			closedAccounts: false
		});
	});

	it('parses value options in short, long and --flag=value forms', () => {
		const { commonOpts, errors } = parseQqrlCommand(
			'reg -b 2025-01 --end=2025-06 -d 2025 -X EUR -S -date --limit 5'
		);

		expect(errors).toEqual([]);
		expect(commonOpts).toMatchObject({
			begin: '2025-01',
			end: '2025-06',
			dateRange: '2025',
			exchange: 'EUR',
			sort: '-date',
			limit: 5
		});
	});

	it('parses boolean flags', () => {
		const { commonOpts } = parseQqrlCommand('bal -T -H -Z -C');

		expect(commonOpts).toMatchObject({
			total: true,
			hierarchy: true,
			zero: true,
			closedAccounts: true
		});
	});

	it('parses depth', () => {
		expect(parseQqrlCommand('bal -D 2').commonOpts.depth).toBe(2);
		expect(parseQqrlCommand('bal --depth=3').commonOpts.depth).toBe(3);
	});

	it('accumulates repeated currency options', () => {
		const { commonOpts } = parseQqrlCommand('bal -c EUR --currency=USD,AUD');

		expect(commonOpts.currency).toEqual(['EUR', 'USD,AUD']);
	});

	it('allows options and accounts to be interleaved', () => {
		const { commonOpts } = parseQqrlCommand('bal Assets -b 2025 Expenses');

		expect(commonOpts.account).toEqual(['Assets', 'Expenses']);
		expect(commonOpts.begin).toBe('2025');
	});

	it('keeps not/@ keywords as plain account tokens for the builder', () => {
		const { commonOpts } = parseQqrlCommand('reg Expenses not Expenses:Rent @grocer');

		expect(commonOpts.account).toEqual(['Expenses', 'not', 'Expenses:Rent', '@grocer']);
	});

	it('swallows the value of ignored options', () => {
		const { commonOpts, errors } = parseQqrlCommand(
			'bal --ledger file.bean --no-pager --empty Assets'
		);

		expect(errors).toEqual([]);
		expect(commonOpts.account).toEqual(['Assets']);
	});

	it('reports invalid numbers', () => {
		expect(parseQqrlCommand('bal -l abc').errors).toEqual(["Invalid limit 'abc'"]);
		expect(parseQqrlCommand('bal -D x').errors).toEqual(["Invalid depth 'x'"]);
	});

	it('reports unsupported and unknown options', () => {
		expect(parseQqrlCommand('bal -a 10').errors).toEqual([
			"Amount filter '10' is not supported in this UI yet"
		]);
		expect(parseQqrlCommand('bal --list').errors).toEqual([
			'The --list option applies to the query command, which is not supported here'
		]);
		expect(parseQqrlCommand('bal --bogus').errors).toEqual(["Unknown option '--bogus'"]);
	});

	it('treats a lone dash as an account token, not an option', () => {
		expect(parseQqrlCommand('bal -').commonOpts.account).toEqual(['-']);
	});
});

describe('quoting', () => {
	it('keeps quoted tokens together', () => {
		const { commonOpts } = parseQqrlCommand(`reg "Expenses:Eating Out" 'Assets:Bank Account'`);

		expect(commonOpts.account).toEqual(['Expenses:Eating Out', 'Assets:Bank Account']);
	});

	it('ends an unterminated quote at end of input', () => {
		expect(parseQqrlCommand('reg "Expenses:Eating').commonOpts.account).toEqual([
			'Expenses:Eating'
		]);
	});
});

describe('lots options', () => {
	it('defaults to active lots', () => {
		const { command, lotsOpts } = parseQqrlCommand('lots');

		expect(command).toBe('lots');
		expect(lotsOpts).toMatchObject({ active: true, showAll: false, closed: false, average: false });
	});

	it('parses shared options plus average and sort-by', () => {
		const { lotsOpts, errors } = parseQqrlCommand(
			'lots Assets:Investments -A -s price -c VTI -l 3'
		);

		expect(errors).toEqual([]);
		expect(lotsOpts).toMatchObject({
			account: ['Assets:Investments'],
			average: true,
			sortBy: 'price',
			currency: ['VTI'],
			limit: 3
		});
	});

	it('makes --active, --all and --closed mutually exclusive, last one wins', () => {
		expect(parseQqrlCommand('lots --all').lotsOpts).toMatchObject({
			active: false,
			showAll: true,
			closed: false
		});
		expect(parseQqrlCommand('lots --closed').lotsOpts).toMatchObject({
			active: false,
			showAll: false,
			closed: true
		});
		expect(parseQqrlCommand('lots --all --active').lotsOpts).toMatchObject({
			active: true,
			showAll: false,
			closed: false
		});
	});

	it('rejects an invalid sort-by', () => {
		expect(parseQqrlCommand('lots -s nonsense').errors).toEqual([
			"Invalid sort-by 'nonsense' (expected date, price, or symbol)"
		]);
	});

	it('does not populate common options for lots', () => {
		expect(parseQqrlCommand('lots Assets').commonOpts.account).toEqual([]);
	});
});
