/*
    Sanity tests for the shared helpers in tests/helpers, so the infrastructure
    other tests build on is itself verified.
*/
import { describe, expect, it } from 'vitest';
import { demoFixtures } from '../helpers/demoFixtures';
import { makeAccount, makeXact } from '../helpers/factories';
import { MemoryBackend } from '../helpers/memoryBackend';
import { mockQueryFn, queryResult } from '../helpers/queryMock';

describe('factories', () => {
	it('makeXact accepts bare account names and overrides', () => {
		const xact = makeXact({
			payee: 'Shop',
			postings: ['Expenses:Food', { account: 'Assets:Cash', amount: -5 }]
		});

		expect(xact.payee).toBe('Shop');
		expect(xact.flag).toBe('*');
		expect(xact.postings.map((p) => p.account)).toEqual(['Expenses:Food', 'Assets:Cash']);
		expect(xact.postings[1].amount).toBe(-5);
	});

	it('makeAccount sets a balance only when given', () => {
		expect(makeAccount('Assets:Cash').balance).toBeUndefined();
		expect(makeAccount('Assets:Cash', { quantity: 3, currency: 'EUR' }).balance?.currency).toBe(
			'EUR'
		);
	});
});

describe('mockQueryFn', () => {
	it('returns the first matching rule and throws on unmatched queries', async () => {
		const query = mockQueryFn([
			{ match: (b) => b.startsWith('SELECT a'), result: queryResult(['a'], [[1]]) }
		]);

		expect((await query('SELECT a')).rows).toEqual([[1]]);
		await expect(query('SELECT b')).rejects.toThrow('Unmatched BQL');
	});
});

describe('MemoryBackend', () => {
	it('reads, writes, lists and tracks modification order', async () => {
		const backend = new MemoryBackend({ 'a.bean': 'one' });
		await backend.writeFile('b.bean', 'two');

		expect(await backend.readFile('a.bean')).toBe('one');
		expect(await backend.readFile('missing')).toBeUndefined();
		expect(await backend.listFiles()).toEqual(['a.bean', 'b.bean']);
		expect((await backend.lastModified('b.bean'))!).toBeGreaterThan(
			(await backend.lastModified('a.bean'))!
		);
	});
});

describe('demoFixtures', () => {
	it('exposes the demo book files by name', () => {
		expect(Object.keys(demoFixtures)).toEqual(
			expect.arrayContaining(['book.bean', 'accounts.bean'])
		);
		expect(demoFixtures['accounts.bean']).toContain('Assets:Bank:Checking');
	});
});
