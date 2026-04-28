import { Xact, Posting } from '$lib/data/model'

export interface ParseResult {
    payee?: string
    amount?: number
    currency?: string
    fromAccount?: string
    toAccount?: string
    note?: string
    confidence: number
    matched: string[]
}

const CURRENCY_MAP: Record<string, string> = {
    euro: 'EUR',
    euros: 'EUR',
    dollar: 'USD',
    dollars: 'USD',
    pound: 'GBP',
    pounds: 'GBP',
    yen: 'JPY',
    franc: 'CHF',
    francs: 'CHF',
    kuna: 'HRK',
    kune: 'HRK',
}

const ACCOUNT_KEYWORDS: Array<{ words: string[]; account: string }> = [
    { words: ['checking', 'bank account', 'current account'], account: 'Assets:Checking' },
    { words: ['savings', 'saving'], account: 'Assets:Savings' },
    { words: ['cash', 'wallet', 'pocket'], account: 'Assets:Cash' },
    {
        words: ['credit card', 'visa', 'mastercard', 'amex', 'american express'],
        account: 'Liabilities:CreditCard',
    },
    { words: ['paypal'], account: 'Assets:PayPal' },
    { words: ['grocery', 'groceries', 'supermarket', 'market'], account: 'Expenses:Groceries' },
    { words: ['restaurant', 'cafe', 'coffee', 'lunch', 'dinner', 'breakfast', 'food', 'eat'], account: 'Expenses:Food' },
    { words: ['transport', 'bus', 'train', 'metro', 'taxi', 'uber', 'fuel', 'gas', 'petrol'], account: 'Expenses:Transport' },
    { words: ['rent', 'mortgage', 'housing'], account: 'Expenses:Housing' },
    { words: ['utilities', 'electricity', 'water', 'internet', 'phone', 'mobile'], account: 'Expenses:Utilities' },
    { words: ['entertainment', 'cinema', 'movie', 'netflix', 'spotify', 'game'], account: 'Expenses:Entertainment' },
    { words: ['health', 'pharmacy', 'doctor', 'medicine', 'medical'], account: 'Expenses:Health' },
    { words: ['clothes', 'clothing', 'shoes', 'fashion'], account: 'Expenses:Clothing' },
    { words: ['salary', 'income', 'paycheck', 'wage', 'wages', 'payroll'], account: 'Income:Salary' },
]

function guessAccount(text: string): string | undefined {
    const lower = text.toLowerCase()
    for (const { words, account } of ACCOUNT_KEYWORDS) {
        if (words.some((w) => lower.includes(w))) return account
    }
    return undefined
}

function parseCurrency(text: string): { amount?: number; currency: string } {
    const patterns = [
        /([€$£¥])\s*(\d+(?:[.,]\d+)?)/,
        /(\d+(?:[.,]\d+)?)\s*([€$£¥])/,
        /(\d+(?:[.,]\d+)?)\s+(euros?|dollars?|pounds?|yen|francs?|kunas?|kune|usd|eur|gbp|chf|hrk)/i,
    ]

    for (const re of patterns) {
        const m = text.match(re)
        if (!m) continue

        let rawAmount: string
        let rawCurrency: string

        if (re === patterns[0]) {
            rawCurrency = m[1]
            rawAmount = m[2]
        } else {
            rawAmount = m[1]
            rawCurrency = m[2]
        }

        const amount = parseFloat(rawAmount.replace(',', '.'))
        const symbolMap: Record<string, string> = { '€': 'EUR', '$': 'USD', '£': 'GBP', '¥': 'JPY' }
        const currency =
            symbolMap[rawCurrency] ??
            CURRENCY_MAP[rawCurrency.toLowerCase()] ??
            rawCurrency.toUpperCase()

        return { amount, currency }
    }

    const numMatch = text.match(/(\d+(?:[.,]\d+)?)/)
    if (numMatch) {
        return { amount: parseFloat(numMatch[1].replace(',', '.')), currency: 'EUR' }
    }

    return { currency: 'EUR' }
}

function extractPayee(text: string): string | undefined {
    const patterns = [
        /(?:at|to|for|from|@)\s+([a-zA-Z][a-zA-Z'&-]*(?:\s+(?!(?:for|to|from|at)\b)[a-zA-Z'&-]+)*)/i,
        /(?:paid|spent|bought|purchased)\s+(?:\d[\d.,]*\s+\w+\s+)?(?:at|to|for)\s+([a-zA-Z][a-zA-Z'&-]*(?:\s+(?!(?:for|to|from|at)\b)[a-zA-Z'&-]+)*)/i,
        /^([A-Z][a-zA-Z\s'&-]{1,20})\s+\d/,
    ]

    for (const re of patterns) {
        const m = text.match(re)
        if (m) {
            const name = m[1].trim()
            return name.charAt(0).toUpperCase() + name.slice(1)
        }
    }

    const stopWords = new Set([
        'paid', 'spent', 'bought', 'received', 'transferred', 'charged',
        'the', 'a', 'an', 'i', 'me', 'my', 'at', 'to', 'for', 'from',
        'euro', 'euros', 'dollar', 'dollars', 'pound', 'pounds', 'yen', 'franc', 'francs',
        'usd', 'eur', 'gbp', 'chf', 'hrk', 'jpy',
    ])
    const words = text.split(/\s+/)
    const payeeWords = words.filter(
        (w) => !stopWords.has(w.toLowerCase()) && /^[a-zA-Z]/.test(w)
    )
    if (payeeWords.length > 0) {
        return payeeWords
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ')
    }

    return undefined
}

export function parseTranscript(text: string): ParseResult {
    const lower = text.toLowerCase()
    const matched: string[] = []
    let confidence = 0

    const { amount, currency } = parseCurrency(text)
    if (amount !== undefined) {
        matched.push(`amount: ${amount} ${currency}`)
        confidence += 40
    }

    const payee = extractPayee(text)
    if (payee) {
        matched.push(`payee: ${payee}`)
        confidence += 20
    }

    const isTransfer = /transfer|move|send/i.test(lower)
    const isIncome = /receive|received|income|salary|paycheck|wage/i.test(lower)

    let fromAccount: string | undefined
    const fromMatch = text.match(/from\s+(?:my\s+)?([a-zA-Z0-9\s]+?)(?:\s+to|\s+account|$)/i)
    if (fromMatch) {
        fromAccount = guessAccount(fromMatch[1]) ?? fromMatch[1].trim()
        matched.push(`from: ${fromAccount}`)
        confidence += 20
    }

    let toAccount: string | undefined
    const toMatch = text.match(/to\s+(?:my\s+)?([a-zA-Z0-9\s]+?)(?:\s+from|\s+account|$)/i)
    if (toMatch && isTransfer) {
        toAccount = guessAccount(toMatch[1]) ?? toMatch[1].trim()
        matched.push(`to: ${toAccount}`)
        confidence += 20
    }

    if (!fromAccount) {
        if (isIncome) {
            fromAccount = guessAccount(text) ?? 'Income:Other'
            toAccount = toAccount ?? 'Assets:Checking'
        } else {
            fromAccount = 'Assets:Checking'
        }
    }

    if (!toAccount && !isTransfer && !isIncome) {
        toAccount = guessAccount(text) ?? 'Expenses:General'
    }

    return { payee, amount, currency, fromAccount, toAccount, confidence: Math.min(confidence, 100), matched }
}

export function buildTransaction(result: ParseResult): Xact {
    const xact = new Xact()
    xact.date = new Date().toISOString().substring(0, 10)
    xact.payee = result.payee ?? 'Unknown'
    xact.flag = '*'

    const posting1 = new Posting()
    posting1.account = result.toAccount ?? 'Expenses:General'
    posting1.amount = result.amount
    posting1.currency = result.currency ?? 'EUR'

    const posting2 = new Posting()
    posting2.account = result.fromAccount ?? 'Assets:Checking'

    xact.postings = [posting1, posting2]
    return xact
}

export function formatBeancount(xact: Xact): string {
    const lines: string[] = []
    lines.push(`${xact.date} ${xact.flag} "${xact.payee}" "${xact.note ?? ''}"`)
    for (const p of xact.postings) {
        const amtStr =
            p.amount !== undefined ? `  ${p.amount.toFixed(2)} ${p.currency}` : ''
        lines.push(`  ${p.account}${amtStr}`)
    }
    return lines.join('\n')
}
