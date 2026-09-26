/*
    Tests for the CRDT record <-> Xact conversion.
*/
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Posting, Xact } from '$lib/data/model';
import {
	XACT_SCHEMA_VERSION,
	fromRecord,
	isNewerSchema,
	toRecord,
	type XactRecord
} from '$lib/storage/crdtXactRecord';
import { makeXact } from '../helpers/factories';

const sample = () =>
	makeXact({
		date: '2025-08-10',
		payee: 'Supermarket',
		note: 'Groceries',
		meta: { receipt: '123' },
		postings: [
			{ account: 'Expenses:Groceries', amount: 45.5, currency: 'EUR' },
			{ account: 'Assets:Bank:Checking', currency: 'EUR' }
		]
	});

// The newer-schema warning also raises a toast; the real toaster needs a live document.
vi.mock('$lib/utils/notifier', () => ({ default: { warning: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

describe('toRecord', () => {
	it('stamps id, schema version and origin, and drops the ledger id', () => {
		const xact = sample();
		xact.id = 42;

		const record = toRecord(xact, 'abc', 'device-1');

		expect(record).toMatchObject({
			id: 'abc',
			schemaVersion: XACT_SCHEMA_VERSION,
			origin: 'device-1',
			payee: 'Supermarket'
		});
	});

	it('produces JSON-clean data with no undefined values', () => {
		const record = toRecord(sample(), 'abc');

		expect(record).toEqual(JSON.parse(JSON.stringify(record)));
		expect('origin' in record).toBe(false);
		expect('amount' in record.postings[1]).toBe(false);
	});
});

describe('fromRecord', () => {
	it('round-trips a transaction', () => {
		const original = sample();

		const restored = fromRecord(toRecord(original, 'abc', 'device-1'));

		expect(restored).toBeInstanceOf(Xact);
		expect(restored.postings[0]).toBeInstanceOf(Posting);
		expect(restored).toEqual(
			Object.assign(new Xact(), { ...original, postings: restored.postings })
		);
		expect(restored.postings.map((p) => [p.account, p.amount])).toEqual([
			['Expenses:Groceries', 45.5],
			['Assets:Bank:Checking', undefined]
		]);
	});

	it('does not leak record bookkeeping into the Xact', () => {
		const restored = fromRecord(toRecord(sample(), 'abc', 'device-1')) as unknown as Record<
			string,
			unknown
		>;

		expect(restored.schemaVersion).toBeUndefined();
		expect(restored.origin).toBeUndefined();
		expect(restored.id).toBeUndefined();
	});
});

describe('schema versions', () => {
	const newer = (id: string): XactRecord => ({
		...toRecord(sample(), id),
		schemaVersion: XACT_SCHEMA_VERSION + 1
	});

	it('detects records written by a newer app', () => {
		expect(isNewerSchema(toRecord(sample(), 'a'))).toBe(false);
		expect(isNewerSchema(newer('a'))).toBe(true);
	});

	it('still reads a newer record, warning only once per record', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const record = newer('warn-once');

		expect(fromRecord(record).payee).toBe('Supermarket');
		fromRecord(record);

		expect(warn).toHaveBeenCalledTimes(1);
	});
});
