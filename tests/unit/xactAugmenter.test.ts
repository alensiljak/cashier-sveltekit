/*
    Tests for XactAugmenter: filling in elided postings, deriving the
    user-facing amount of a transaction, and adjusting account balances.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/utils/notifier', () => ({ default: { warning: vi.fn(), error: vi.fn() } }));
const appServiceMock = vi.hoisted(() => ({
	getDefaultCurrency: vi.fn(async () => 'EUR'),
	loadAccountTransactionsFor: vi.fn(async (): Promise<unknown[]> => [])
}));
vi.mock('$lib/services/appService', () => ({ default: appServiceMock }));

import Notifier from '$lib/utils/notifier';
import { XactAugmenter } from '$lib/utils/xactAugmenter';
import { makeAccount, makeXact } from '../helpers/factories';

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.mocked(Notifier.warning).mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('calculateEmptyPostingAmounts', () => {
	it('balances the single empty posting and gives it the common currency', () => {
		const xact = makeXact({
			postings: [
				{ account: 'Expenses:Food', amount: 10, currency: 'EUR' },
				{ account: 'Assets:Cash' }
			]
		});

		XactAugmenter.calculateEmptyPostingAmounts([xact]);

		expect(xact.postings[1]).toMatchObject({ amount: -10, currency: 'EUR' });
	});

	it('sums several filled postings', () => {
		const xact = makeXact({
			postings: [
				{ account: 'Expenses:Food', amount: 10, currency: 'EUR' },
				{ account: 'Expenses:Drink', amount: 5.5, currency: 'EUR' },
				{ account: 'Assets:Cash' }
			]
		});

		XactAugmenter.calculateEmptyPostingAmounts([xact]);

		expect(xact.postings[2].amount).toBe(-15.5);
	});

	it('keeps an existing currency on the empty posting', () => {
		const xact = makeXact({
			postings: [
				{ account: 'Expenses:Food', amount: 10, currency: 'EUR' },
				{ account: 'Assets:Cash', currency: 'EUR' }
			]
		});

		XactAugmenter.calculateEmptyPostingAmounts([xact]);

		expect(xact.postings[1]).toMatchObject({ amount: -10, currency: 'EUR' });
	});

	it('leaves a fully specified transaction alone', () => {
		const xact = makeXact({
			postings: [
				{ account: 'Expenses:Food', amount: 10, currency: 'EUR' },
				{ account: 'Assets:Cash', amount: -10, currency: 'EUR' }
			]
		});

		XactAugmenter.calculateEmptyPostingAmounts([xact]);

		expect(xact.postings.map((p) => p.amount)).toEqual([10, -10]);
	});

	it('skips transactions with several currencies', () => {
		const xact = makeXact({
			payee: 'Trip',
			postings: [
				{ account: 'Expenses:Food', amount: 10, currency: 'EUR' },
				{ account: 'Expenses:Fun', amount: 5, currency: 'USD' },
				{ account: 'Assets:Cash' }
			]
		});

		XactAugmenter.calculateEmptyPostingAmounts([xact]);

		expect(xact.postings[2].amount).toBeUndefined();
		expect(warn).toHaveBeenCalled();
	});

	it('warns and skips when more than one posting is empty', () => {
		const xact = makeXact({
			payee: 'Shop',
			postings: [
				{ account: 'Expenses:Food', amount: 10, currency: 'EUR' },
				{ account: 'Assets:Cash' },
				{ account: 'Assets:Bank' }
			]
		});

		XactAugmenter.calculateEmptyPostingAmounts([xact]);

		expect(xact.postings[1].amount).toBeUndefined();
		expect(Notifier.warning).toHaveBeenCalledWith('Multiple empty postings found on Shop');
	});

	it('copes with a transaction without postings and returns the same array', () => {
		const xacts = [makeXact()];

		expect(XactAugmenter.calculateEmptyPostingAmounts(xacts)).toBe(xacts);
	});

	// TODO: a posting with an explicit amount of 0 is treated as "empty" (`!posting.amount`),
	// so `Expenses:Gift 0 EUR` next to a real posting gets overwritten. Decide if that's intended.
});

describe('calculateXactAmount', () => {
	const posting = (account: string, amount?: number, currency = 'EUR') => ({
		account,
		amount,
		currency
	});

	it('uses the single asset/liability posting, with its sign', () => {
		const xact = makeXact({
			postings: [posting('Expenses:Food', 10), posting('Assets:Cash', -10.004)]
		});

		expect(XactAmount(xact)).toEqual({ quantity: -10, currency: 'EUR' });
	});

	it('shows a transfer between two assets as a positive amount', () => {
		const xact = makeXact({
			postings: [posting('Assets:Bank', -50), posting('Assets:Cash', 50)]
		});

		expect(XactAmount(xact)).toEqual({ quantity: 50, currency: 'EUR' });
	});

	it('takes the sign from the asset posting for asset + liability', () => {
		const xact = makeXact({
			postings: [posting('Liabilities:CreditCard', 30), posting('Assets:Bank', -30)]
		});

		expect(XactAmount(xact).quantity).toBe(-30);
	});

	it('returns an empty balance when the first of two postings has no amount', () => {
		const xact = makeXact({ postings: [posting('Assets:Bank'), posting('Assets:Cash', 5)] });

		expect(XactAmount(xact).quantity).toBe(0);
	});

	it('warns and returns an empty balance with no asset postings', () => {
		const xact = makeXact({ postings: [posting('Expenses:Food', 5), posting('Income:Gift', -5)] });

		expect(XactAmount(xact).quantity).toBe(0);
		expect(warn).toHaveBeenCalledWith('No postings found in Assets or Liabilities!');
	});

	it('warns for complex transactions with three or more asset postings', () => {
		const xact = makeXact({
			postings: [posting('Assets:A', 1), posting('Assets:B', 2), posting('Assets:C', -3)]
		});

		XactAmount(xact);

		expect(warn).toHaveBeenCalledWith('more than one posting found with assets');
	});

	function XactAmount(xact: ReturnType<typeof makeXact>) {
		const { quantity, currency } = XactAugmenter.calculateXactAmount(xact);
		return { quantity, currency };
	}
});

describe('calculateXactAmounts', () => {
	it('completes empty postings first, then returns one amount per transaction', () => {
		const xacts = [
			makeXact({
				postings: [
					{ account: 'Expenses:Food', amount: 10, currency: 'EUR' },
					{ account: 'Assets:Cash' }
				]
			})
		];

		const amounts = XactAugmenter.calculateXactAmounts(xacts);

		expect(amounts).toHaveLength(1);
		expect(amounts[0]).toMatchObject({ quantity: -10, currency: 'EUR' });
	});
});

describe('adjustAccountBalances', () => {
	beforeEach(() => appServiceMock.loadAccountTransactionsFor.mockReset());

	it('adds the device transactions to the ledger balance', async () => {
		const account = makeAccount('Assets:Cash', { quantity: 100, currency: 'EUR' });
		appServiceMock.loadAccountTransactionsFor.mockResolvedValue([
			makeXact({ postings: [{ account: 'Assets:Cash', amount: -20.5, currency: 'EUR' }] }),
			makeXact({ postings: [{ account: 'Assets:Cash', amount: 5, currency: 'EUR' }] })
		]);

		const [adjusted] = await new XactAugmenter().adjustAccountBalances([account]);

		expect(adjusted.balance?.quantity).toBe(84.5);
		expect(appServiceMock.loadAccountTransactionsFor).toHaveBeenCalledWith('Assets:Cash');
	});

	it('rounds to two decimals', async () => {
		const account = makeAccount('Assets:Cash', { quantity: 0.1, currency: 'EUR' });
		appServiceMock.loadAccountTransactionsFor.mockResolvedValue([
			makeXact({ postings: [{ account: 'Assets:Cash', amount: 0.2, currency: 'EUR' }] })
		]);

		const [adjusted] = await new XactAugmenter().adjustAccountBalances([account]);

		expect(adjusted.balance?.quantity).toBe(0.3);
	});

	it('gives an account without a starting balance the default currency', async () => {
		const account = makeAccount('Assets:Cash');
		appServiceMock.loadAccountTransactionsFor.mockResolvedValue([
			makeXact({ postings: [{ account: 'Assets:Cash', amount: 12, currency: 'EUR' }] })
		]);

		const [adjusted] = await new XactAugmenter().adjustAccountBalances([account]);

		expect(adjusted.balance).toMatchObject({ quantity: 12, currency: 'EUR' });
	});

	it('leaves the balance unchanged when there are no device postings', async () => {
		const account = makeAccount('Assets:Cash', { quantity: 100, currency: 'EUR' });

		const [adjusted] = await new XactAugmenter().adjustAccountBalances([account]);

		expect(adjusted.balance?.quantity).toBe(100);
	});

	it('returns a missing list as-is', async () => {
		expect(await new XactAugmenter().adjustAccountBalances(undefined as never)).toBeUndefined();
	});
});
