import { Xact, Posting } from '$lib/data/model';

export interface ParseResult {
	payee?: string;
	amount?: number;
	currency?: string;
	fromAccount?: string;
	toAccount?: string;
	note?: string;
	confidence: number;
	matched: string[];
	/** True when a field was missing and a generic/fallback account or value was substituted. */
	needsReview: boolean;
	isTransfer: boolean;
	isIncome: boolean;
	/** False when fromAccount/toAccount is a bare top-level fallback (Assets/Expenses/Income), not a specific guess. */
	fromAccountResolved: boolean;
	toAccountResolved: boolean;
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
	kune: 'HRK'
};

const ACCOUNT_KEYWORDS: Array<{ words: string[]; account: string }> = [
	{ words: ['checking', 'bank account', 'current account'], account: 'Assets:Checking' },
	{ words: ['savings', 'saving'], account: 'Assets:Savings' },
	{ words: ['cash', 'wallet', 'pocket'], account: 'Assets:Cash' },
	{
		words: ['credit card', 'visa', 'mastercard', 'amex', 'american express'],
		account: 'Liabilities:CreditCard'
	},
	{ words: ['paypal'], account: 'Assets:PayPal' },
	{ words: ['grocery', 'groceries', 'supermarket', 'market'], account: 'Expenses:Groceries' },
	{
		words: ['restaurant', 'cafe', 'coffee', 'lunch', 'dinner', 'breakfast', 'food', 'eat'],
		account: 'Expenses:Food'
	},
	{
		words: ['transport', 'bus', 'train', 'metro', 'taxi', 'uber', 'fuel', 'gas', 'petrol'],
		account: 'Expenses:Transport'
	},
	{ words: ['rent', 'mortgage', 'housing'], account: 'Expenses:Housing' },
	{
		words: ['utilities', 'electricity', 'water', 'internet', 'phone', 'mobile'],
		account: 'Expenses:Utilities'
	},
	{
		words: ['entertainment', 'cinema', 'movie', 'netflix', 'spotify', 'game'],
		account: 'Expenses:Entertainment'
	},
	{ words: ['health', 'pharmacy', 'doctor', 'medicine', 'medical'], account: 'Expenses:Health' },
	{ words: ['clothes', 'clothing', 'shoes', 'fashion'], account: 'Expenses:Clothing' },
	{ words: ['salary', 'income', 'paycheck', 'wage', 'wages', 'payroll'], account: 'Income:Salary' }
];

function guessAccount(text: string, prefix?: string): string | undefined {
	const lower = text.toLowerCase();
	for (const { words, account } of ACCOUNT_KEYWORDS) {
		if (prefix && !account.startsWith(prefix)) continue;
		if (
			words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower))
		) {
			return account;
		}
	}
	return undefined;
}

function parseCurrency(text: string): { amount?: number; currency: string } {
	const patterns = [
		/([€$£¥])\s*(\d+(?:[.,]\d+)?)/,
		/(\d+(?:[.,]\d+)?)\s*([€$£¥])/,
		/(\d+(?:[.,]\d+)?)\s+(euros?|dollars?|pounds?|yen|francs?|kunas?|kune|usd|eur|gbp|chf|hrk)/i
	];

	for (const re of patterns) {
		const m = text.match(re);
		if (!m) continue;

		let rawAmount: string;
		let rawCurrency: string;

		if (re === patterns[0]) {
			rawCurrency = m[1];
			rawAmount = m[2];
		} else {
			rawAmount = m[1];
			rawCurrency = m[2];
		}

		const amount = parseFloat(rawAmount.replace(',', '.'));
		const symbolMap: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP', '¥': 'JPY' };
		const currency =
			symbolMap[rawCurrency] ??
			CURRENCY_MAP[rawCurrency.toLowerCase()] ??
			rawCurrency.toUpperCase();

		return { amount, currency };
	}

	// Only a standalone numeric token counts as a bare amount — skip digits embedded in an
	// alphanumeric word like "n26" (an account name fragment), which isn't an amount.
	const numMatch = text.match(/(?:^|\s)(\d+(?:[.,]\d+)?)(?=\s|$)/);
	if (numMatch) {
		return { amount: parseFloat(numMatch[1].replace(',', '.')), currency: 'EUR' };
	}

	return { currency: 'EUR' };
}

function extractPayee(text: string): string | undefined {
	const patterns = [
		/(?:at|to|for|from|@)\s+([a-zA-Z][a-zA-Z'&-]*(?:\s+(?!(?:for|to|from|at)\b)[a-zA-Z'&-]+)*)/i,
		/(?:paid|spent|bought|purchased)\s+(?:\d[\d.,]*\s+\w+\s+)?(?:at|to|for)\s+([a-zA-Z][a-zA-Z'&-]*(?:\s+(?!(?:for|to|from|at)\b)[a-zA-Z'&-]+)*)/i,
		/^([A-Z][a-zA-Z\s'&-]{1,20})\s+\d/
	];

	for (const re of patterns) {
		const m = text.match(re);
		if (m) {
			const name = m[1].trim();
			return name.charAt(0).toUpperCase() + name.slice(1);
		}
	}

	const stopWords = new Set([
		'paid',
		'spent',
		'bought',
		'received',
		'transferred',
		'charged',
		'the',
		'a',
		'an',
		'i',
		'me',
		'my',
		'at',
		'to',
		'for',
		'from',
		'euro',
		'euros',
		'dollar',
		'dollars',
		'pound',
		'pounds',
		'yen',
		'franc',
		'francs',
		'usd',
		'eur',
		'gbp',
		'chf',
		'hrk',
		'jpy'
	]);
	const words = text.split(/\s+/);
	const payeeWords = words.filter((w) => !stopWords.has(w.toLowerCase()) && /^[a-zA-Z]/.test(w));
	if (payeeWords.length > 0) {
		return payeeWords.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
	}

	return undefined;
}

export function parseTranscript(text: string): ParseResult {
	const lower = text.toLowerCase();
	const matched: string[] = [];
	let confidence = 0;

	const { amount, currency } = parseCurrency(text);
	if (amount !== undefined) {
		matched.push(`amount: ${amount} ${currency}`);
		confidence += 40;
	}

	const payee = extractPayee(text);
	if (payee) {
		matched.push(`payee: ${payee}`);
		confidence += 20;
	}

	const isTransfer = /transfer|move|send/i.test(lower);
	const isIncome = /receive|received|income|salary|paycheck|wage/i.test(lower);

	let fromAccount: string | undefined;
	let fromAccountResolved = false;
	const fromMatch = text.match(/from\s+(?:my\s+)?([a-zA-Z0-9\s]+?)(?:\s+to|\s+account|$)/i);
	if (fromMatch) {
		fromAccount = guessAccount(fromMatch[1]) ?? fromMatch[1].trim();
		fromAccountResolved = true;
		matched.push(`from: ${fromAccount}`);
		confidence += 20;
	}

	let toAccount: string | undefined;
	let toAccountResolved = false;
	const toMatch = text.match(/to\s+(?:my\s+)?([a-zA-Z0-9\s]+?)(?:\s+from|\s+account|$)/i);
	if (toMatch && isTransfer) {
		toAccount = guessAccount(toMatch[1]) ?? toMatch[1].trim();
		toAccountResolved = true;
		matched.push(`to: ${toAccount}`);
		confidence += 20;
	}

	if (!fromAccount) {
		if (isIncome) {
			const guess = guessAccount(text, 'Income:');
			fromAccount = guess ?? 'Income';
			fromAccountResolved = !!guess;
			if (!toAccount) {
				// Top-level fallback — no specific account known, flag for review.
				toAccount = 'Assets';
				toAccountResolved = false;
			}
		} else {
			// Top-level fallback — no specific account known, flag for review.
			fromAccount = 'Assets';
			fromAccountResolved = false;
		}
	}

	if (!toAccount && !isTransfer && !isIncome) {
		const guess = guessAccount(text, 'Expenses:');
		toAccount = guess ?? 'Expenses';
		toAccountResolved = !!guess;
	}

	const needsReview = !payee || amount === undefined || !fromAccountResolved || !toAccountResolved;

	return {
		payee,
		amount,
		currency,
		fromAccount,
		toAccount,
		confidence: Math.min(confidence, 100),
		matched,
		needsReview,
		isTransfer,
		isIncome,
		fromAccountResolved,
		toAccountResolved
	};
}

/**
 * Picks the single best transaction to model a synthetic suggestion after, out of a set of
 * loose-search matches (already ordered most-recent-first). Groups candidates by their
 * (payee, account-set) shape and returns a representative of the most frequent group — ties
 * broken by recency, which falls out for free since `candidates` is date-descending and the
 * first-seen representative of each group is kept.
 */
export function pickBestMatch(candidates: Xact[]): Xact | undefined {
	const groups = new Map<string, { count: number; representative: Xact }>();
	for (const xact of candidates) {
		const accounts = xact.postings
			.map((p) => p.account)
			.sort()
			.join('\u0000');
		const key = `${xact.payee ?? ''}\u0000${accounts}`;
		const group = groups.get(key);
		if (group) {
			group.count += 1;
		} else {
			groups.set(key, { count: 1, representative: xact });
		}
	}

	let best: { count: number; representative: Xact } | undefined;
	for (const group of groups.values()) {
		if (!best || group.count > best.count) best = group;
	}
	return best?.representative;
}

/**
 * Fills in payee/account fields still unresolved (or only generically guessed) from the
 * most frequent matching transaction found by search, so terse fragments like "vang vti"
 * resolve to the real payee ("Vanguard") and accounts instead of a capitalized-words guess
 * and generic Assets/Expenses fallback. Amount/currency stay from the live parse — the
 * historical amount isn't what the user is entering now.
 */
export function refineFromMatches(result: ParseResult, matches: Xact[]): void {
	if (result.isTransfer) return;
	if (result.fromAccountResolved && result.toAccountResolved) return;

	const best = pickBestMatch(matches);
	if (!best) return;

	const assetAccount = best.postings
		.map((p) => p.account)
		.find((a) => a.startsWith('Assets:') || a.startsWith('Liabilities:'));
	const otherAccount = best.postings.map((p) => p.account).find((a) => a !== assetAccount);
	if (!assetAccount || !otherAccount) return;

	if (best.payee) result.payee = best.payee;

	if (result.isIncome) {
		result.fromAccount = otherAccount;
		result.fromAccountResolved = true;
		result.toAccount = assetAccount;
		result.toAccountResolved = true;
	} else {
		result.toAccount = otherAccount;
		result.toAccountResolved = true;
		result.fromAccount = assetAccount;
		result.fromAccountResolved = true;
	}
	result.matched.push(`from ${matches.length} match(es): ${otherAccount}, ${assetAccount}`);
	result.needsReview = !result.payee || result.amount === undefined;
}

export function buildTransaction(result: ParseResult): Xact {
	const xact = new Xact();
	xact.date = new Date().toISOString().substring(0, 10);
	xact.payee = result.payee ?? 'Unknown';
	xact.flag = result.needsReview ? '!' : '*';

	const posting1 = new Posting();
	posting1.account = result.toAccount ?? 'Expenses';
	posting1.amount = result.amount;
	posting1.currency = result.currency ?? 'EUR';

	const posting2 = new Posting();
	posting2.account = result.fromAccount ?? 'Assets';

	xact.postings = [posting1, posting2];
	return xact;
}

export function formatBeancount(xact: Xact): string {
	const lines: string[] = [];
	lines.push(`${xact.date} ${xact.flag} "${xact.payee}" "${xact.note ?? ''}"`);
	for (const p of xact.postings) {
		const amtStr = p.amount !== undefined ? `  ${p.amount.toFixed(2)} ${p.currency}` : '';
		lines.push(`  ${p.account}${amtStr}`);
	}
	return lines.join('\n');
}
