/*
    Tests for transaction parser.
    Parsing a Ledger transaction record.
*/
import { expect, test } from 'vitest';
import { parseXact } from '$lib/utils/transactionParser';
import { Posting, Xact } from '$lib/data/model';

test('parsing a typical xact', () => {
    // arrange
    const ledgerXact: string = `2024-12-01 Supermarket
    ; some food
    Expenses:Food  13 EUR
    Assets:Cash`;

    const p1 = new Posting()
    p1.account = "Expenses:Food"
    p1.amount = 13
    p1.currency = "EUR"
    const p2 = new Posting()
    p2.account = "Assets:Cash"

    const expected = new Xact();
    expected.date = '2024-12-01'
    expected.payee = 'Supermarket'
    expected.note = "some food"
    expected.postings = [p1, p2]

    // act
    const result = parseXact(ledgerXact)

    // assert
    expect(result).toStrictEqual(expected);
});

test('parse a transfer', () => {
    // arrange
    const ledgerXact: string = `2024-12-02 Transfer
    ; cash deposit
    Assets:Bank  100 EUR
    Assets:Cash  -100 EUR`;

    const p1 = new Posting()
    Object.assign(p1, {
        account: "Assets:Bank",
        amount: 100,
        currency: "EUR",
    })

    const p2 = new Posting()
    Object.assign(p2, {
        account: "Assets:Cash",
        amount: -100,
        currency: "EUR",
    })

    const expected = new Xact()
    Object.assign(expected, {
        date: '2024-12-02',
        payee: 'Transfer',
        note: 'cash deposit',
        postings: [p1, p2],
    })

    // act
    const result = parseXact(ledgerXact)

    // assert
    expect(result).toStrictEqual(expected);
})