import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearDraft,
	loadDraft,
	postingKeys,
	restoreTicks,
	saveDraft,
	type ReconcileDraft
} from '#lib/reconciliation/draft';

const posting = (date: string, payee: string, amount: number, narration = '') => ({
	date,
	payee,
	narration,
	amount
});

const draft = (over: Partial<ReconcileDraft> = {}): ReconcileDraft => ({
	account: 'Assets:Bank',
	statementDate: '2026-10-31',
	statementBalance: '123.45',
	currency: 'EUR',
	tickedKeys: ['k1'],
	...over
});

describe('postingKeys', () => {
	it('does not depend on ledger ids', () => {
		const a = postingKeys([posting('2026-10-01', 'Shop', -5)]);
		const b = postingKeys([posting('2026-10-01', 'Shop', -5)]);
		expect(a).toEqual(b);
	});

	it('tells identical postings apart by occurrence', () => {
		const keys = postingKeys([
			posting('2026-10-01', 'Shop', -5),
			posting('2026-10-01', 'Shop', -5),
			posting('2026-10-02', 'Shop', -5)
		]);
		expect(new Set(keys).size).toBe(3);
	});
});

describe('restoreTicks', () => {
	it('ticks the postings whose keys were saved and drops unknown keys', () => {
		const keys = postingKeys([posting('2026-10-01', 'A', 1), posting('2026-10-02', 'B', 2)]);
		expect(restoreTicks(keys, [keys[1], 'gone'])).toEqual([false, true]);
		expect(restoreTicks(keys, [])).toEqual([false, false]);
	});
});

describe('draft storage', () => {
	beforeEach(() => localStorage.clear());

	it('round-trips a draft per account', () => {
		saveDraft(draft());
		saveDraft(draft({ account: 'Assets:Other', statementBalance: '1' }));
		expect(loadDraft('Assets:Bank')).toEqual(draft());
		expect(loadDraft('Assets:Other')?.statementBalance).toBe('1');
	});

	it('returns undefined when there is no draft', () => {
		expect(loadDraft('Assets:Bank')).toBeUndefined();
	});

	it('ignores corrupt or mismatched stored data', () => {
		localStorage.setItem('cashier.reconcileDraft.Assets:Bank', '{not json');
		expect(loadDraft('Assets:Bank')).toBeUndefined();
		localStorage.setItem(
			'cashier.reconcileDraft.Assets:Bank',
			JSON.stringify(draft({ account: 'Assets:Other' }))
		);
		expect(loadDraft('Assets:Bank')).toBeUndefined();
	});

	it('clears a draft', () => {
		saveDraft(draft());
		clearDraft('Assets:Bank');
		expect(loadDraft('Assets:Bank')).toBeUndefined();
	});

	it('does not throw when storage is unavailable', () => {
		const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('quota');
		});
		expect(() => saveDraft(draft())).not.toThrow();
		spy.mockRestore();
	});
});
