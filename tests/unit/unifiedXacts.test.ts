/*
    Tests for the unified transaction rows: merging device + ledger rows,
    highlight links, and opening a row's details.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { gotoMock, queryMock } = vi.hoisted(() => ({ gotoMock: vi.fn(), queryMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/services/ledgerWorkerClient', () => ({ default: { query: queryMock } }));
vi.mock('$lib/utils/notifier', () => ({ default: { error: vi.fn(), warning: vi.fn() } }));

import Notifier from '$lib/utils/notifier';
import { xact, xactId } from '$lib/data/mainStore';
import {
	buildHighlightParams,
	findHighlightedRow,
	mergeUnifiedRows,
	openXactDetails,
	type UnifiedXact
} from '$lib/utils/unifiedXacts';
import { makeXact } from '../helpers/factories';

const row = (overrides: Partial<UnifiedXact> = {}): UnifiedXact => ({
	date: '2025-08-10',
	payee: 'Shop',
	narration: 'Food',
	amount: -10,
	currency: 'EUR',
	account: 'Assets:Cash',
	isDevice: false,
	...overrides
});

beforeEach(() => {
	gotoMock.mockReset();
	queryMock.mockReset();
	vi.mocked(Notifier.error).mockClear();
	xact.set(makeXact());
	xactId.set(undefined);
});

describe('mergeUnifiedRows', () => {
	it('marks the matching ledger row as a device row instead of duplicating it', () => {
		const deviceXact = makeXact({ payee: 'Shop' });
		const device = row({ isDevice: true, xact: deviceXact, id: 'dev-1' });
		const ledger = row({ rledgerId: 7 });

		const merged = mergeUnifiedRows([device], [ledger]);

		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({ isDevice: true, id: 'dev-1', rledgerId: 7 });
		expect(merged[0].xact).toBe(deviceXact);
	});

	it.each([
		['date', { date: '2025-08-11' }],
		['payee', { payee: 'Other' }],
		['amount', { amount: -11 }],
		['currency', { currency: 'USD' }],
		['account', { account: 'Assets:Bank' }]
	])('does not match when the %s differs', (_field, change) => {
		const merged = mergeUnifiedRows(
			[row({ isDevice: true, id: 'd', ...change })],
			[row({ rledgerId: 1 })]
		);

		expect(merged).toHaveLength(2);
		expect(merged.find((r) => r.rledgerId === 1)?.isDevice).toBe(false);
	});

	it('sorts everything by date, newest first', () => {
		const merged = mergeUnifiedRows(
			[row({ date: '2025-08-20', isDevice: true, id: 'd', payee: 'unmatched' })],
			[row({ date: '2025-08-01', rledgerId: 1 }), row({ date: '2025-08-30', rledgerId: 2 })]
		);

		expect(merged.map((r) => r.date)).toEqual(['2025-08-30', '2025-08-20', '2025-08-01']);
	});

	it('handles empty inputs', () => {
		expect(mergeUnifiedRows([], [])).toEqual([]);
		expect(mergeUnifiedRows([], [row()])).toHaveLength(1);
		expect(mergeUnifiedRows([row({ isDevice: true, id: 'd' })], [])).toHaveLength(1);
	});
});

describe('highlight links', () => {
	const posting = { account: 'Assets:Cash', amount: -10, currency: 'EUR' } as never;

	it('uses the ledger id when the transaction has one', () => {
		const params = buildHighlightParams(makeXact({ id: 42 }), posting);

		expect([...params.entries()]).toEqual([['highlightId', '42']]);
	});

	it('falls back to a composite key for device transactions', () => {
		const params = buildHighlightParams(
			makeXact({ date: '2025-08-10', payee: 'Shop', note: 'Food' }),
			posting
		);

		expect(Object.fromEntries(params)).toEqual({
			highlightDate: '2025-08-10',
			highlightPayee: 'Shop',
			highlightNarration: 'Food',
			highlightAmount: '-10',
			highlightCurrency: 'EUR'
		});
	});

	it('finds a row by ledger id', () => {
		const rows = [row({ rledgerId: 1 }), row({ rledgerId: 2 })];

		expect(findHighlightedRow(rows, new URLSearchParams('highlightId=2'))).toBe(rows[1]);
		expect(findHighlightedRow(rows, new URLSearchParams('highlightId=9'))).toBeUndefined();
	});

	it('finds a device row by composite key, round-tripping buildHighlightParams', () => {
		const rows = [row({ payee: 'Other' }), row({ isDevice: true, id: 'd' })];
		const params = buildHighlightParams(
			makeXact({ date: '2025-08-10', payee: 'Shop', note: 'Food' }),
			posting
		);

		expect(findHighlightedRow(rows, params)).toBe(rows[1]);
	});

	it('finds nothing without highlight params', () => {
		expect(findHighlightedRow([row()], new URLSearchParams())).toBeUndefined();
	});
});

describe('openXactDetails', () => {
	it('opens a device row straight from its stored transaction', async () => {
		const deviceXact = makeXact({ payee: 'Shop' });

		await openXactDetails(row({ isDevice: true, xact: deviceXact, id: 'dev-1' }));

		expect(get(xact)).toBe(deviceXact);
		expect(get(xactId)).toBe('dev-1');
		expect(gotoMock).toHaveBeenCalledWith('/xact-actions');
		expect(queryMock).not.toHaveBeenCalled();
	});

	it('loads a ledger row by id and builds a read-only transaction', async () => {
		queryMock.mockResolvedValue({
			columns: ['flag', 'account', 'number', 'currency'],
			rows: [
				['!', 'Expenses:Food', '10.5', 'EUR'],
				['!', 'Assets:Cash', '-10.5', 'EUR']
			],
			errors: []
		});

		await openXactDetails(row({ rledgerId: 7 }));

		expect(queryMock).toHaveBeenCalledWith('SELECT flag, account, number, currency WHERE id = 7');
		const opened = get(xact);
		expect(opened).toMatchObject({
			id: 7,
			date: '2025-08-10',
			payee: 'Shop',
			note: 'Food',
			flag: '!'
		});
		expect(opened.postings.map((p) => [p.account, p.amount, p.currency])).toEqual([
			['Expenses:Food', 10.5, 'EUR'],
			['Assets:Cash', -10.5, 'EUR']
		]);
		expect(get(xactId)).toBeUndefined();
		expect(gotoMock).toHaveBeenCalledWith('/xact-actions');
	});

	it('falls back to date/payee/narration, escaping double quotes', async () => {
		queryMock.mockResolvedValue({ columns: [], rows: [], errors: [] });

		await openXactDetails(row({ payee: 'The "Best" Shop', narration: 'say "hi"' }));

		expect(queryMock).toHaveBeenCalledWith(
			'SELECT flag, account, number, currency WHERE date = 2025-08-10 AND payee = "The \\"Best\\" Shop" AND narration = "say \\"hi\\""'
		);
	});

	it('uses an empty-payee clause when there is no payee', async () => {
		queryMock.mockResolvedValue({ columns: [], rows: [], errors: [] });

		await openXactDetails(row({ payee: '' }));

		expect(queryMock.mock.calls[0][0]).toContain('AND payee = ""');
	});

	it('reports an error and does not navigate when nothing is found', async () => {
		queryMock.mockResolvedValue({ columns: [], rows: [], errors: [] });

		await openXactDetails(row({ rledgerId: 7 }));

		expect(Notifier.error).toHaveBeenCalledWith('Could not load transaction details');
		expect(gotoMock).not.toHaveBeenCalled();
	});
});
