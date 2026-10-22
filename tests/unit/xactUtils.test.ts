import { describe, it, expect, beforeAll } from 'vitest';
import { ensureInitialized, createParsedLedger } from '#lib/services/rustledger';
import { elideMirroredAmount, xactToBeancountText } from '#lib/utils/xactUtils';
import { Xact, Posting } from '#lib/data/model';

describe('quick-entry note round-trip', () => {
	beforeAll(async () => {
		await ensureInitialized();
	});

	function postingAccounts(text: string): string[] {
		const ledger = createParsedLedger(text);
		expect(ledger).not.toBeNull();
		try {
			const directives = ledger!.getDirectives();
			return (directives[0] as any).postings.map((p: any) => p.account);
		} finally {
			ledger!.free();
		}
	}

	it('keeps both postings when one is an explicit 0 and the other elided (NLP quick-entry shape)', () => {
		const tx = new Xact();
		tx.date = '2026-09-05';
		tx.flag = '!';
		tx.note = 'Lunch';
		const p1 = new Posting();
		p1.account = 'Expenses:Hospitality:Dining';
		p1.amount = 0;
		p1.currency = 'EUR';
		const p2 = new Posting();
		p2.account = 'Assets:Cash-Accounts:EUR';
		tx.postings = [p1, p2];

		const text = xactToBeancountText(tx, 'EUR');

		// A single elided posting that interpolates to zero is silently dropped by
		// the ledger engine on the next parse — the generated text must not rely on it.
		expect(text).toContain('Assets:Cash-Accounts:EUR  0 EUR');
		expect(postingAccounts(text)).toEqual([
			'Expenses:Hospitality:Dining',
			'Assets:Cash-Accounts:EUR'
		]);
	});

	it('keeps both postings when neither has an amount (manual note-entry shape)', () => {
		const tx = new Xact();
		tx.date = '2026-09-05';
		tx.flag = '!';
		tx.payee = 'Supermarket';
		const p1 = new Posting();
		p1.account = 'Expenses:Groceries';
		const p2 = new Posting();
		p2.account = 'Assets:Bank-Accounts:N26';
		tx.postings = [p1, p2];

		const text = xactToBeancountText(tx, 'EUR');

		expect(postingAccounts(text)).toEqual(['Expenses:Groceries', 'Assets:Bank-Accounts:N26']);
	});

	it('still lets a single non-zero amount auto-balance the other posting', () => {
		const tx = new Xact();
		tx.date = '2026-09-05';
		tx.flag = '*';
		tx.payee = 'Supermarket';
		const p1 = new Posting();
		p1.account = 'Expenses:Groceries';
		p1.amount = 42;
		p1.currency = 'EUR';
		const p2 = new Posting();
		p2.account = 'Assets:Bank-Accounts:N26';
		tx.postings = [p1, p2];

		const text = xactToBeancountText(tx, 'EUR');

		// The auto-balance amount here is -42, not zero, so eliding it is safe and
		// should be left alone rather than forced explicit.
		expect(text).not.toContain('Assets:Bank-Accounts:N26  0 EUR');
		expect(postingAccounts(text)).toEqual(['Expenses:Groceries', 'Assets:Bank-Accounts:N26']);
	});
});

describe('elideMirroredAmount', () => {
	function makeXact(...postings: Partial<Posting>[]): Xact {
		const tx = new Xact();
		tx.postings = postings.map((p) => Object.assign(new Posting(), p));
		return tx;
	}

	it('drops the second amount when the two amounts mirror each other', () => {
		const tx = makeXact(
			{ account: 'Expenses:Food', amount: 10, currency: 'EUR' },
			{ account: 'Assets:Cash', amount: -10, currency: 'EUR' }
		);
		expect(elideMirroredAmount(tx)).toBe(true);
		expect(tx.postings[0].amount).toBe(10);
		expect(tx.postings[1].amount).toBeUndefined();
	});

	it('leaves amounts that differ', () => {
		const tx = makeXact(
			{ account: 'Expenses:Food', amount: 10, currency: 'EUR' },
			{ account: 'Assets:Cash', amount: -9, currency: 'EUR' }
		);
		expect(elideMirroredAmount(tx)).toBe(false);
		expect(tx.postings[1].amount).toBe(-9);
	});

	it('leaves different currencies, priced postings and more than two postings', () => {
		const currencies = makeXact(
			{ account: 'A', amount: 10, currency: 'EUR' },
			{ account: 'B', amount: -10, currency: 'USD' }
		);
		const priced = makeXact(
			{ account: 'A', amount: 10, currency: 'EUR', priceAmount: 1.1, priceCurrency: 'USD' },
			{ account: 'B', amount: -10, currency: 'EUR' }
		);
		const three = makeXact(
			{ account: 'A', amount: 10, currency: 'EUR' },
			{ account: 'B', amount: -10, currency: 'EUR' },
			{ account: 'C', amount: 0, currency: 'EUR' }
		);
		for (const tx of [currencies, priced, three]) {
			expect(elideMirroredAmount(tx)).toBe(false);
		}
	});
});
