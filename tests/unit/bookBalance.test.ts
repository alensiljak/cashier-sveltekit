import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryResult } from '../helpers/queryMock';

const mocks = vi.hoisted(() => ({
	ensureLoaded: vi.fn(async () => {}),
	query: vi.fn(),
	getDirectives: vi.fn(async (): Promise<unknown[]> => [])
}));
vi.mock('#lib/services/ledgerWorkerClient', () => ({
	default: {
		ensureLoaded: mocks.ensureLoaded,
		query: mocks.query,
		getDirectives: mocks.getDirectives
	}
}));

import {
	loadAccountPostings,
	loadBookBalance,
	loadLatestAssertion
} from '#lib/reconciliation/bookBalance';

beforeEach(() => {
	mocks.query.mockReset();
	mocks.getDirectives.mockReset();
});

describe('loadBookBalance', () => {
	it('sums the account in one currency up to and including the date', async () => {
		mocks.query.mockResolvedValue(queryResult(['balance'], [['123.45']]));
		expect(await loadBookBalance('Assets:Bank', 'EUR', '2026-10-31')).toBeCloseTo(123.45);
		const bql = mocks.query.mock.calls[0][0] as string;
		expect(bql).toContain("account = 'Assets:Bank'");
		expect(bql).toContain("currency = 'EUR'");
		expect(bql).toContain('date <= 2026-10-31');
	});

	it('is zero when nothing matches', async () => {
		mocks.query.mockResolvedValue(queryResult(['balance'], []));
		expect(await loadBookBalance('A', 'EUR', '2026-01-01')).toBe(0);
		mocks.query.mockResolvedValue(queryResult(['balance'], [[null]]));
		expect(await loadBookBalance('A', 'EUR', '2026-01-01')).toBe(0);
	});

	it('escapes quotes in the account name', async () => {
		mocks.query.mockResolvedValue(queryResult(['balance'], [['1']]));
		await loadBookBalance("Assets:O'Brien", 'EUR', '2026-01-01');
		expect(mocks.query.mock.calls[0][0]).toContain("'Assets:O''Brien'");
	});

	it('throws on query errors', async () => {
		mocks.query.mockResolvedValue({ columns: [], rows: [], errors: ['boom'] });
		await expect(loadBookBalance('A', 'EUR', '2026-01-01')).rejects.toThrow('boom');
	});
});

describe('loadAccountPostings', () => {
	const columns = ['id', 'date', 'payee', 'narration', 'flag', 'number'];

	it('maps rows to postings, defaulting empty fields', async () => {
		mocks.query.mockResolvedValue(
			queryResult(columns, [
				[7, '2026-10-02', 'Shop', 'Food', '!', '-12.50'],
				[8, '2026-10-03', null, null, null, '100']
			])
		);
		expect(await loadAccountPostings('Assets:Bank', 'EUR', '2026-10-31')).toEqual([
			{ id: 7, date: '2026-10-02', payee: 'Shop', narration: 'Food', flag: '!', amount: -12.5 },
			{ id: 8, date: '2026-10-03', payee: '', narration: '', flag: '*', amount: 100 }
		]);
	});

	it('bounds the window with from and to', async () => {
		mocks.query.mockResolvedValue(queryResult(columns, []));
		await loadAccountPostings('A', 'EUR', '2026-10-31', '2026-09-01');
		const bql = mocks.query.mock.calls[0][0] as string;
		expect(bql).toContain('date >= 2026-09-01');
		expect(bql).toContain('date <= 2026-10-31');

		await loadAccountPostings('A', 'EUR', '2026-10-31');
		expect(mocks.query.mock.calls[1][0]).not.toContain('date >=');
	});
});

describe('loadLatestAssertion', () => {
	it('uses the ledger directives', async () => {
		mocks.getDirectives.mockResolvedValue([
			{
				type: 'balance',
				date: '2026-03-01',
				account: 'Assets:Bank',
				amount: { number: '250.50', currency: 'EUR' }
			}
		]);
		expect(await loadLatestAssertion('Assets:Bank', 'EUR', '2026-04-01')).toMatchObject({
			date: '2026-03-01',
			amount: 250.5
		});
	});
});
