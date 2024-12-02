/*
    tests for transaction parser
*/
import { expect, test } from 'vitest';
import { parseXact } from '$lib/utils/transactionParser';
import { Posting, Xact } from '$lib/data/model';

test('parsing the Ledger transaction record', () => {
    // arrange
    const p1 = new Posting()
    p1.account = "Expenses:Food"
    p1.amount = 13
    p1.currency = "EUR"
    const p2 = new Posting()
    p2.account = "Assets:Cash"

    const ledgerXact: string = `2024-12-01 Supermarket
    ; some food
    Expenses:Food  13 EUR
    Assets:Cash`;
    const expected = new Xact();
    expected.date = '2024-12-01'
    expected.payee = 'Supermarket'
    expected.note = "some food"
    expected.postings = [p1, p2]

    // act
    const result = parseXact(ledgerXact)

    // assert
    console.log(result)
    expect(result).toStrictEqual(expected);
});