import { expect, test } from 'vitest'
import { parseTranscript } from '$lib/utils/voiceNlp'

test('currency word is not picked as payee', () => {
    const result = parseTranscript('50 euro at billa')

    expect(result.payee).toBe('Billa')
    expect(result.amount).toBe(50)
    expect(result.currency).toBe('EUR')
})

test('expense category keyword sets toAccount, not fromAccount', () => {
    const result = parseTranscript('15 euro groceries at billa')

    expect(result.payee).toBe('Billa')
    expect(result.amount).toBe(15)
    expect(result.toAccount).toBe('Expenses:Groceries')
    expect(result.fromAccount).toMatch(/^Assets:/)
    expect(result.toAccount).not.toBe(result.fromAccount)
})

test('"at <payee> for <category>" strips category from payee name', () => {
    const result = parseTranscript('20 euros at lidl for groceries')

    expect(result.payee).toBe('Lidl')
    expect(result.amount).toBe(20)
    expect(result.currency).toBe('EUR')
    expect(result.toAccount).toBe('Expenses:Groceries')
})

test('"car wash" two-word payee with no keyword is captured fully', () => {
    const result = parseTranscript('15 euros car wash')

    expect(result.payee).toBe('Car Wash')
    expect(result.amount).toBe(15)
    expect(result.currency).toBe('EUR')
})

test('"from <alphanumeric-name>" captures account name with digits', () => {
    const result = parseTranscript('20 euros at lidl for groceries from n26')

    expect(result.payee).toBe('Lidl')
    expect(result.amount).toBe(20)
    expect(result.currency).toBe('EUR')
    expect(result.toAccount).toBe('Expenses:Groceries')
    expect(result.fromAccount).toBe('n26')
})
