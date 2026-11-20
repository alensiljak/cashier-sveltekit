import { Xact, Posting } from '#lib/data/model';

/** How a field was resolved against the ledger (see `entityResolution.ts`). */
export type ResolutionKind = 'exact' | 'fuzzy' | 'guessed' | 'ambiguous';

export interface FieldResolution {
	kind: ResolutionKind;
	/** Other plausible values, best first; tappable when `kind` is `ambiguous`. */
	alternatives: string[];
}

export type ResolvableField = 'payee' | 'toAccount' | 'fromAccount';

export interface ParseResult {
	payee?: string;
	/** Filled by `resolveEntities`: how each field was matched against the ledger. */
	resolution?: Partial<Record<ResolvableField, FieldResolution>>;
	amount?: number;
	currency?: string;
	fromAccount?: string;
	toAccount?: string;
	/** Words from the input that weren't recognized as amount/payee/account — kept so the user can follow up. */
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
	/** Internal: normalized (lowercased, punctuation-stripped) words consumed by the payee guess,
	 *  so refineFromMatches can recover any that don't survive into the final matched payee. */
	_payeeWords?: string[];
	/** Internal: original-case counterpart of `_payeeWords`, same order — used when recovered words are appended to the note. */
	_payeeWordsOriginal?: string[];
	/** Internal: normalized words consumed by amount/currency/account recognition — excluded from the leftover note. */
	_consumedWords?: Set<string>;
	/** Internal: original-case words already known to be unrecognized (not payee, not consumed). */
	_leftoverWords?: string[];
}

/** Connector/filler words that never belong in the leftover narration, whether or not they end up consumed elsewhere. */
export const STOP_WORDS = new Set([
	'paid',
	'spent',
	'bought',
	'purchased',
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

/** Strips leading/trailing punctuation and lowercases, for matching a raw token against consumed/stop-word sets. */
function normalizeWord(word: string): string {
	return word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
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
	kunas: 'HRK',
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
		account: 'Expenses:Hospitality:Drinks'
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

function guessAccount(
	text: string,
	prefix?: string
): { account: string; matchedWords: string[] } | undefined {
	const lower = text.toLowerCase();
	for (const { words, account } of ACCOUNT_KEYWORDS) {
		if (prefix && !account.startsWith(prefix)) continue;
		const hit = words.find((w) =>
			new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)
		);
		if (hit) {
			return { account, matchedWords: hit.split(/\s+/) };
		}
	}
	return undefined;
}

/**
 * A numeric amount token: digits with optional `.`/`,` separator groups. Both separators are
 * allowed and may repeat, so locale-grouped amounts ("1.500,50", "1,500.50", "1.500.000")
 * arrive here whole instead of being truncated at the first separator.
 */
const AMOUNT_TOKEN = String.raw`\d+(?:[.,]\d+)*`;

/**
 * Turns a raw amount token into a number, deciding which separator is the decimal point from
 * the token's shape rather than assuming a locale — speech input mixes both conventions.
 *
 * - both `.` and `,` present: the LAST one is the decimal separator, the other groups thousands
 *   ("1.500,50" -> 1500.5, "1,500.50" -> 1500.5)
 * - one separator kind, repeated: it groups thousands ("1.500.000" -> 1500000)
 * - one separator, exactly three digits after it, no leading zero: groups thousands
 *   ("1.500" -> 1500, "1,500" -> 1500) — the ambiguous case, resolved the way people speak
 * - otherwise: it is the decimal separator ("25,50" -> 25.5, "0.500" -> 0.5)
 *
 * Returns undefined for a token with no digits.
 */
export function parseAmountToken(raw: string): number | undefined {
	const token = raw.trim();
	if (!/\d/.test(token)) return undefined;

	const lastDot = token.lastIndexOf('.');
	const lastComma = token.lastIndexOf(',');

	if (lastDot !== -1 && lastComma !== -1) {
		const decimalSep = lastDot > lastComma ? '.' : ',';
		const groupSep = decimalSep === '.' ? ',' : '.';
		const normalized = token.split(groupSep).join('').replace(decimalSep, '.');
		return parseFloat(normalized);
	}

	const sep = lastDot !== -1 ? '.' : lastComma !== -1 ? ',' : '';
	if (!sep) return parseFloat(token);

	const parts = token.split(sep);
	// A repeated separator can only be grouping ("1.500.000").
	if (parts.length > 2) return parseFloat(parts.join(''));

	const [whole, fraction] = parts as [string, string];
	// "1.500" / "1,500": three trailing digits and no leading zero reads as a thousands group.
	if (fraction.length === 3 && whole !== '0' && !whole.startsWith('0')) {
		return parseFloat(whole + fraction);
	}
	return parseFloat(`${whole}.${fraction}`);
}

/** Spoken number words, as they appear in dictation. */
const NUMBER_WORDS: Record<string, number> = {
	zero: 0,
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
	eleven: 11,
	twelve: 12,
	thirteen: 13,
	fourteen: 14,
	fifteen: 15,
	sixteen: 16,
	seventeen: 17,
	eighteen: 18,
	nineteen: 19,
	twenty: 20,
	thirty: 30,
	forty: 40,
	fifty: 50,
	sixty: 60,
	seventy: 70,
	eighty: 80,
	ninety: 90
};

/** Multipliers that scale the number accumulated so far. */
const NUMBER_SCALES: Record<string, number> = {
	hundred: 100,
	thousand: 1000,
	million: 1000000
};

/** Words that may join number words without breaking the run ("twenty-five", "one hundred and five"). */
const NUMBER_JOINERS = new Set(['and']);

/** True when the word is a number word or scale word ("five", "hundred"). */
function isNumberWord(word: string): boolean {
	const norm = normalizeWord(word);
	if (norm.length === 0) return false;
	// Hyphenated forms ("twenty-five", "one-hundred") count when every part is a number word.
	return norm
		.split('-')
		.every((part) => part.length > 0 && (part in NUMBER_WORDS || part in NUMBER_SCALES));
}

/**
 * Matches a run of spoken number words, e.g. "twenty-five", "one hundred and five",
 * "two thousand five hundred". Deliberately conservative: it only matches words that are
 * unambiguously numeric, so a payee like "One Stop" is not swallowed as an amount.
 */
const NUMBER_WORD_RUN_SOURCE = (() => {
	const nums = Object.keys(NUMBER_WORDS).join('|');
	const scales = Object.keys(NUMBER_SCALES).join('|');
	// "and" is only a joiner right after a scale word and before another number word
	// ("one hundred and five"); anywhere else ("two and five", "coffee and two") it ends the run.
	const unit = String.raw`(?:(?:${scales})(?:[\s-]+and(?=[\s-]+(?:${nums}|${scales})\b))?|${nums})`;
	return String.raw`${unit}(?:[\s-]+${unit}){0,6}`;
})();
const NUMBER_WORD_RUN = new RegExp(String.raw`\b(${NUMBER_WORD_RUN_SOURCE})\b`, 'gi');

/** Scale words that may follow a digit amount ("2 thousand euros", "1.5 million"). */
const SCALE_WORD_SOURCE = Object.keys(NUMBER_SCALES).join('|');

/**
 * Converts a run of spoken number words to a number, or undefined when the run holds no
 * numeric word. Handles the additive/multiplicative shape of English number words:
 * "twenty-five" -> 25, "one hundred and five" -> 105, "two thousand five hundred" -> 2500.
 *
 * A trailing "hundred"/"thousand" with nothing after it still counts ("a hundred" -> 100).
 */
export function parseNumberWords(phrase: string): number | undefined {
	const words = phrase
		.toLowerCase()
		.split(/[\s-]+/)
		.filter((w) => w.length > 0 && !NUMBER_JOINERS.has(w));
	// "a hundred" / "an hundred": the article stands in for "one" before a scale word.
	if (words.length > 1 && (words[0] === 'a' || words[0] === 'an')) words.shift();
	if (words.length === 0) return undefined;

	let total = 0;
	// The part of the number below the last scale word ("two thousand five hundred" -> 500).
	let current = 0;
	let sawNumber = false;

	for (const word of words) {
		const value = NUMBER_WORDS[word];
		if (value !== undefined) {
			current += value;
			sawNumber = true;
			continue;
		}

		const scale = NUMBER_SCALES[word];
		if (scale !== undefined) {
			sawNumber = true;
			// "a hundred" / "hundred" with no leading number means one of them.
			current = (current || 1) * scale;
			if (scale >= 1000) {
				total += current;
				current = 0;
			}
			continue;
		}

		// A non-number word inside the run ends it; ignore the rest.
		break;
	}

	if (!sawNumber) return undefined;
	return total + current;
}

/** The currency words recognised after an amount, shared by the digit and spoken-number paths. */
const CURRENCY_WORD_ALTERNATION =
	'euros?|dollars?|pounds?|yen|francs?|kunas?|kune|usd|eur|gbp|chf|hrk|jpy';
/** Currency words that may follow an amount ("twenty-five euros"). Unanchored: callers add `^`. */
const CURRENCY_WORD_SOURCE = String.raw`(${CURRENCY_WORD_ALTERNATION})\b`;

/** Sentence-joining words that are not stop words elsewhere but never name a thing either. */
const FUNCTION_WORDS = new Set([
	'on',
	'in',
	'with',
	'of',
	'by',
	'via',
	'into',
	'using',
	'is',
	'was'
]);

/**
 * True when `word` is a content word — something that names a thing rather than joining a
 * sentence. Used to tell a price ("twenty-five euros") from a quantifier ("one coffee").
 */
function isContentWord(word: string): boolean {
	const norm = normalizeWord(word);
	return (
		norm.length > 0 &&
		!STOP_WORDS.has(norm) &&
		!NUMBER_JOINERS.has(norm) &&
		!FUNCTION_WORDS.has(norm)
	);
}

/**
 * Reads a fractional "cents" part right after a currency word: "twenty-five euros fifty",
 * "twenty euros and fifty cents", "12 euros 50". Returns the cents (0-99) and the words used.
 *
 * A bare number after the currency could be a quantity ("20 euros 2 coffees"), so without an
 * explicit "cents" word it only counts when nothing that names a thing follows it.
 */
function parseCentsSuffix(after: string): { cents: number; words: string[] } | undefined {
	const m = after.match(
		new RegExp(
			String.raw`^\s+(?:and\s+)?(?:(\d{1,2})|(${NUMBER_WORD_RUN_SOURCE}))(?:\s+(cents?))?\b`,
			'i'
		)
	);
	if (!m) return undefined;

	const cents = m[1] !== undefined ? parseInt(m[1], 10) : parseNumberWords(m[2]!);
	if (cents === undefined || cents > 99) return undefined;

	if (!m[3]) {
		const nextWord = after.slice(m[0].length).trim().split(/\s+/)[0];
		if (nextWord && isContentWord(nextWord)) return undefined;
	}

	return {
		cents,
		words: m[0]
			.trim()
			.split(/\s+/)
			.filter((w) => !NUMBER_JOINERS.has(w.toLowerCase()))
	};
}

/** Adds a cents part to a whole amount without floating-point residue. */
function withCents(amount: number, cents: number): number {
	return Math.round(amount * 100 + cents) / 100;
}

/**
 * Finds a spoken amount ("twenty-five euros", "a hundred dollars") and its currency.
 * Only consulted when no digit amount was found, so an explicit numeral always wins.
 *
 * A spoken number is only read as a price when it is unambiguous, because number words are
 * also ordinary English quantifiers and name parts ("one coffee", "at One Stop"). It counts
 * when a currency word follows it, or when it is the only content word in the phrase. A
 * content word after it means it is quantifying that word, so it is left alone.
 */
function parseNumberWordAmount(
	text: string,
	defaultCurrency: string,
	mode: 'currency-only' | 'any'
): { amount?: number; currency: string; matchedWords: string[] } | undefined {
	// Every run is considered, not just the first: "two coffees for twenty euros" must skip the
	// quantifier "two" and find the priced "twenty". A run followed by a currency word wins
	// outright; otherwise the first run that passes the lone-number check is the fallback.
	let loneCandidate: { amount: number; matchedWords: string[] } | undefined;

	for (const m of text.matchAll(NUMBER_WORD_RUN)) {
		const amount = parseNumberWords(m[1]);
		if (amount === undefined) continue;

		const after = text.slice(m.index + m[0].length);
		const currencyMatch = after.match(new RegExp(String.raw`^\s*${CURRENCY_WORD_SOURCE}`, 'i'));

		if (currencyMatch) {
			const key = currencyMatch[1]!.toLowerCase();
			const matchedWords = [...m[0].split(/\s+/), ...currencyMatch[0].trim().split(/\s+/)];
			const centsPart = parseCentsSuffix(after.slice(currencyMatch[0].length));
			if (centsPart) matchedWords.push(...centsPart.words);
			return {
				amount: centsPart ? withCents(amount, centsPart.cents) : amount,
				currency: CURRENCY_MAP[key] ?? key.toUpperCase(),
				matchedWords
			};
		}

		if (mode === 'currency-only') continue;

		// "Lidl, forty-six, forty-eight": two spoken numbers in a row, no currency word, read as
		// whole and cents (46.48). Only a comma/space-separated pair with nothing content-like
		// after it counts, so "two, three coffees" stays a quantity.
		const pair = after.match(new RegExp(String.raw`^[\s,]+(${NUMBER_WORD_RUN_SOURCE})\b`, 'i'));
		if (pair) {
			const cents = parseNumberWords(pair[1]);
			const nextWord = after.slice(pair[0].length).trim().split(/\s+/)[0];
			if (cents !== undefined && cents <= 99 && !(nextWord && isContentWord(nextWord))) {
				return {
					amount: withCents(amount, cents),
					currency: defaultCurrency,
					matchedWords: [...m[0].split(/\s+/), ...pair[1].split(/\s+/)]
				};
			}
		}

		if (loneCandidate) continue;

		// No currency word: the number must stand alone. Any content word after it means it is
		// quantifying that word ("one coffee", "two tickets") or naming something ("One Stop").
		const nextWord = after.trim().split(/\s+/)[0];
		if (nextWord && isContentWord(nextWord)) continue;
		// Content words before it are fine ("paid twenty-five"), but a name before it is not:
		// "at One Stop" has the number inside the name, so require the number to be the only
		// content word in the whole phrase.
		const before = text.slice(0, m.index);
		if (before.split(/\s+/).some(isContentWord)) continue;

		loneCandidate = { amount, matchedWords: m[0].split(/\s+/) };
	}

	return loneCandidate && { ...loneCandidate, currency: defaultCurrency };
}

function parseCurrency(
	text: string,
	defaultCurrency: string
): {
	amount?: number;
	currency: string;
	matchedWords: string[];
} {
	const patterns = [
		new RegExp(String.raw`([€$£¥])\s*(${AMOUNT_TOKEN})`),
		new RegExp(String.raw`(${AMOUNT_TOKEN})\s*([€$£¥])`),
		// Optional scale word between amount and currency: "2 thousand euros".
		new RegExp(
			String.raw`(${AMOUNT_TOKEN})(?:\s+(${SCALE_WORD_SOURCE}))?\s+(${CURRENCY_WORD_ALTERNATION})\b`,
			'i'
		)
	];

	for (const re of patterns) {
		const m = text.match(re);
		if (!m) continue;

		let rawAmount: string;
		let rawCurrency: string;

		if (re === patterns[0]) {
			rawCurrency = m[1];
			rawAmount = m[2];
		} else if (re === patterns[1]) {
			rawAmount = m[1];
			rawCurrency = m[2];
		} else {
			rawAmount = m[1];
			rawCurrency = m[3];
		}

		let amount = parseAmountToken(rawAmount);
		if (amount === undefined) continue;
		const matchedWords = m[0].split(/\s+/);
		if (re === patterns[2]) {
			if (m[2]) amount *= NUMBER_SCALES[m[2].toLowerCase()]!;
			const centsPart = parseCentsSuffix(text.slice(m.index! + m[0].length));
			if (centsPart) {
				amount = withCents(amount, centsPart.cents);
				matchedWords.push(...centsPart.words);
			}
		}
		const symbolMap: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP', '¥': 'JPY' };
		const currency =
			symbolMap[rawCurrency] ??
			CURRENCY_MAP[rawCurrency.toLowerCase()] ??
			rawCurrency.toUpperCase();

		return { amount, currency, matchedWords };
	}

	// A spoken number followed by a currency word is an explicit price, so it outranks a bare
	// numeral that is more likely a quantity ("2 coffees for twenty euros" -> 20, not 2).
	const pricedWords = parseNumberWordAmount(text, defaultCurrency, 'currency-only');
	if (pricedWords) return pricedWords;

	// Only a standalone numeric token counts as a bare amount — skip digits embedded in an
	// alphanumeric word like "n26" (an account name fragment), which isn't an amount.
	const numMatch = text.match(new RegExp(String.raw`(?:^|\s)(${AMOUNT_TOKEN})(?=\s|$)`));
	if (numMatch) {
		let amount = parseAmountToken(numMatch[1]);
		if (amount !== undefined) {
			const matchedWords = [numMatch[1]];
			// "2 thousand at billa": a scale word right after the numeral multiplies it.
			const scale = text
				.slice(numMatch.index! + numMatch[0].length)
				.match(new RegExp(String.raw`^\s+(${SCALE_WORD_SOURCE})\b`, 'i'));
			if (scale) {
				amount *= NUMBER_SCALES[scale[1]!.toLowerCase()]!;
				matchedWords.push(scale[1]!);
			}
			return { amount, currency: defaultCurrency, matchedWords };
		}
	}

	// No numeral and no priced number word — accept a lone spoken number ("twenty-five at billa").
	// Checked last so an explicit numeral always wins over a word that happens to be numeric.
	const wordAmount = parseNumberWordAmount(text, defaultCurrency, 'any');
	if (wordAmount) return wordAmount;

	return { currency: defaultCurrency, matchedWords: [] };
}

/*
	Beancount semantics: the payee is WHO we paid, the narration is WHAT we paid for.
	"at/to/@" (and, weakly, "from") introduce the payee; "for" introduces the narration.
	So "10 euros for tickets at brumby's" is Brumby's (payee) / tickets (narration), not
	the reverse — the "for …" span is cut out of the text before the payee is looked for,
	so neither the preposition patterns nor the bare-words fallback can claim it.

	An explicit "for" phrase is kept as the narration verbatim even when its words also
	drive the expense-account guess ("for coffee" -> Expenses:Food *and* narration
	"coffee"): the user said what they bought, so it belongs in the transaction.

	When no vendor preposition is present at all, the "for" phrase is the only name in the
	input, so it becomes the payee instead ("10 euros for Decathlon") — unless every word
	in it is a spending-category keyword ("for groceries"), which names the expense account
	rather than a counterparty and so stays narration, leaving the payee for review.
*/
const PREPOSITIONS = String.raw`for|to|from|at|@`;
/** One payee-name token: anything word-ish that contains at least one letter, so amounts don't join the name. */
const NAME_TOKEN = String.raw`[a-zA-Z0-9'&.-]*[a-zA-Z][a-zA-Z0-9'&.-]*`;
/** A run of name tokens, stopping before the next preposition. */
const NAME_PHRASE = `(${NAME_TOKEN}(?:\\s+(?!(?:${PREPOSITIONS})\\b)${NAME_TOKEN})*)`;

const NARRATION_RE = new RegExp(String.raw`\bfor\s+${NAME_PHRASE}`, 'i');

/** Every single word appearing in ACCOUNT_KEYWORDS, for deciding whether a phrase names a category rather than a payee. */
const CATEGORY_WORDS = new Set(
	ACCOUNT_KEYWORDS.flatMap(({ words }) => words.flatMap((w) => w.split(/\s+/)))
);

/** True when the phrase is nothing but category/filler words ("groceries", "the bus") — a category, not a counterparty. */
function isCategoryPhrase(phrase: string): boolean {
	const content = phrase
		.split(/\s+/)
		.map(normalizeWord)
		.filter((w) => w.length > 0 && !STOP_WORDS.has(w));
	return content.length > 0 && content.every((w) => CATEGORY_WORDS.has(w));
}

/** Leading determiners that belong to the sentence, not to the business name ("at the pharmacy" -> "Pharmacy"). */
const LEADING_ARTICLES = new Set(['the', 'a', 'an', 'my', 'our']);

/** Trims sentence articles off the front of a captured name and capitalizes it, preserving any inner casing. */
function toPayeeName(name: string): string {
	const tokens = name.trim().split(/\s+/);
	while (tokens.length > 1 && LEADING_ARTICLES.has(tokens[0].toLowerCase())) tokens.shift();
	const cleaned = tokens.join(' ');
	return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function extractPayee(text: string): {
	payee?: string;
	consumedWords: string[];
	/** Original-case words of the "for <what>" phrase, when it wasn't used as the payee. */
	narrationWords: string[];
} {
	// Cut out the "for <what>" span first — it describes the purchase, not the counterparty.
	const narration = text.match(NARRATION_RE);
	const narrationWords = narration ? narration[1].trim().split(/\s+/) : [];
	const vendorText =
		narration?.index === undefined
			? text
			: `${text.slice(0, narration.index)} ${text.slice(narration.index + narration[0].length)}`;

	const patterns = [
		new RegExp(
			String.raw`(?:paid|spent|bought|purchased)\s+(?:\d[\d.,]*\s+\w+\s+)?(?:at|to|@)\s+${NAME_PHRASE}`,
			'i'
		),
		new RegExp(String.raw`(?:\bat|\bto|@)\s+${NAME_PHRASE}`, 'i'),
		// "from" names the counterparty only when nothing better did (e.g. "received 500 from acme").
		new RegExp(String.raw`\bfrom\s+${NAME_PHRASE}`, 'i'),
		/^([A-Z][a-zA-Z\s'&-]{1,20})\s+\d/
	];

	for (const re of patterns) {
		const m = vendorText.match(re);
		if (m) {
			return { payee: toPayeeName(m[1]), consumedWords: m[0].split(/\s+/), narrationWords };
		}
	}

	// No vendor preposition anywhere — the "for" phrase is then the only name in the input, so
	// it becomes the payee unless it just names a spending category ("for groceries").
	if (narration && !isCategoryPhrase(narration[1])) {
		return {
			payee: toPayeeName(narration[1]),
			consumedWords: narration[0].split(/\s+/),
			narrationWords: []
		};
	}

	const words = vendorText.split(/\s+/);
	// Number words are amounts or quantifiers, never part of a counterparty's name — without
	// this, "paid five hundred euros rent" yields the payee "Five Hundred Rent".
	const payeeWords = words.filter(
		(w) => !STOP_WORDS.has(normalizeWord(w)) && !isNumberWord(w) && /^[a-zA-Z]/.test(w)
	);
	if (payeeWords.length > 0) {
		return {
			// Dictation adds punctuation ("Lidl, ..."), which is not part of the name.
			payee: payeeWords
				.map((w) => toPayeeName(w.toLowerCase().replace(/[,;:!?]+$/, '')))
				.join(' '),
			consumedWords: payeeWords,
			narrationWords
		};
	}

	return { consumedWords: [], narrationWords };
}

/** Words from the original input not accounted for by amount/payee/account recognition, in original order/casing. */
function computeLeftover(text: string, consumed: Set<string>): string[] {
	return text
		.split(/\s+/)
		.filter((w) => w.length > 0)
		.filter((w) => {
			const norm = normalizeWord(w);
			return norm.length > 0 && !STOP_WORDS.has(norm) && !consumed.has(norm);
		});
}

/** Options for `parseTranscript`. */
export interface ParseOptions {
	/**
	 * Currency to assume when the utterance names none ("50 at billa"). Defaults to EUR so the
	 * parser stays pure and synchronous; callers with a loaded book pass its operating currency.
	 */
	defaultCurrency?: string;
}

export function parseTranscript(text: string, options: ParseOptions = {}): ParseResult {
	const lower = text.toLowerCase();
	const matched: string[] = [];
	let confidence = 0;
	const consumedWords = new Set<string>();
	const defaultCurrency = options.defaultCurrency?.trim().toUpperCase() || 'EUR';

	const { amount, currency, matchedWords: amountWords } = parseCurrency(text, defaultCurrency);
	amountWords.forEach((w) => consumedWords.add(normalizeWord(w)));
	if (amount !== undefined) {
		matched.push(`amount: ${amount} ${currency}`);
		confidence += 40;
	}

	const { payee: payeeGuess, consumedWords: payeeWordsRaw, narrationWords } = extractPayee(text);
	let payee = payeeGuess;
	const payeeWordPairs = payeeWordsRaw
		.map((w) => ({ original: w, normalized: normalizeWord(w) }))
		.filter((p) => p.normalized.length > 0 && !STOP_WORDS.has(p.normalized));
	const normalizedPayeeWords = payeeWordPairs.map((p) => p.normalized);
	const originalPayeeWords = payeeWordPairs.map((p) => p.original);
	normalizedPayeeWords.forEach((w) => consumedWords.add(w));
	// The explicit "for <what>" phrase is the narration; mark it consumed so `computeLeftover`
	// doesn't repeat it, and keep it ahead of any other unrecognized words in the note.
	narrationWords.forEach((w) => consumedWords.add(normalizeWord(w)));
	if (narrationWords.length > 0) {
		matched.push(`narration: ${narrationWords.join(' ')}`);
		confidence += 10;
	}

	const isTransfer = /transfer|move|send/i.test(lower);
	const isIncome = /receive|received|income|salary|paycheck|wage/i.test(lower);

	let fromAccount: string | undefined;
	let fromAccountResolved = false;
	const fromMatch = text.match(/from\s+(?:my\s+)?([a-zA-Z0-9\s]+?)(?:\s+to|\s+account|$)/i);
	if (fromMatch) {
		fromAccount = guessAccount(fromMatch[1])?.account ?? fromMatch[1].trim();
		fromAccountResolved = true;
		matched.push(`from: ${fromAccount}`);
		confidence += 20;
		fromMatch[0].split(/\s+/).forEach((w) => consumedWords.add(normalizeWord(w)));
	}

	let toAccount: string | undefined;
	let toAccountResolved = false;
	const toMatch = text.match(/to\s+(?:my\s+)?([a-zA-Z0-9\s]+?)(?:\s+from|\s+account|$)/i);
	if (toMatch && isTransfer) {
		toAccount = guessAccount(toMatch[1])?.account ?? toMatch[1].trim();
		toAccountResolved = true;
		matched.push(`to: ${toAccount}`);
		confidence += 20;
		toMatch[0].split(/\s+/).forEach((w) => consumedWords.add(normalizeWord(w)));
	}

	if (!fromAccount) {
		if (isIncome) {
			const guess = guessAccount(text, 'Income:');
			fromAccount = guess?.account ?? 'Income:Unknown';
			fromAccountResolved = !!guess;
			guess?.matchedWords.forEach((w) => consumedWords.add(normalizeWord(w)));
			if (!toAccount) {
				// Top-level fallback — no specific account known, flag for review.
				toAccount = 'Assets:Unknown';
				toAccountResolved = false;
			}
		} else {
			// Top-level fallback — no specific account known, flag for review.
			fromAccount = 'Assets:Unknown';
			fromAccountResolved = false;
		}
	}

	if (!toAccount && !isTransfer && !isIncome) {
		const guess = guessAccount(text, 'Expenses:');
		toAccount = guess?.account ?? 'Expenses:Unknown';
		toAccountResolved = !!guess;
		guess?.matchedWords.forEach((w) => consumedWords.add(normalizeWord(w)));
	}
	// A transfer between own accounts has no counterparty: "…to savings" names the destination
	// account, so don't also report it as the payee.
	if (isTransfer && payee) {
		const accountNames = [fromAccount, toAccount]
			.filter((a): a is string => !!a)
			.map((a) => a.slice(a.lastIndexOf(':') + 1).toLowerCase());
		if (accountNames.includes(payee.toLowerCase())) payee = undefined;
	}

	if (payee) {
		matched.push(`payee: ${payee}`);
		confidence += 20;
	}

	// A transfer legitimately has no payee, so its absence isn't something to review there.
	const needsReview =
		(!payee && !isTransfer) || amount === undefined || !fromAccountResolved || !toAccountResolved;
	const leftoverWords = [...narrationWords, ...computeLeftover(text, consumedWords)];

	return {
		payee,
		amount,
		currency,
		fromAccount,
		toAccount,
		note: leftoverWords.length > 0 ? leftoverWords.join(' ') : undefined,
		confidence: Math.min(confidence, 100),
		matched,
		needsReview,
		isTransfer,
		isIncome,
		fromAccountResolved,
		toAccountResolved,
		_payeeWords: normalizedPayeeWords,
		_payeeWordsOriginal: originalPayeeWords,
		_consumedWords: consumedWords,
		_leftoverWords: leftoverWords
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

	if (best.payee) {
		// Recover any input words that were folded into the pre-refine payee guess but don't
		// survive into the matched entity's real payee (e.g. "deca t-shirt" -> "Decathlon"
		// drops "t-shirt") — keep them in the note instead of silently discarding them.
		const newLower = best.payee.toLowerCase();
		const normalized = result._payeeWords ?? [];
		const original = result._payeeWordsOriginal ?? normalized;
		const dropped = normalized
			.map((n, i) => (newLower.includes(n) ? null : original[i]))
			.filter((w): w is string => !!w);
		if (dropped.length > 0) {
			result._leftoverWords = [...(result._leftoverWords ?? []), ...dropped];
			result.note = result._leftoverWords.join(' ');
		}
		result.payee = best.payee;
	}

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

export function buildTransaction(result: ParseResult, options: ParseOptions = {}): Xact {
	const xact = new Xact();
	xact.date = new Date().toISOString().substring(0, 10);
	// Transfers have no counterparty; everything else gets a visible placeholder to fix up.
	xact.payee = result.payee ?? (result.isTransfer ? '' : 'Unknown');
	xact.note = result.note ?? '';
	xact.flag = result.needsReview ? '!' : '*';

	const posting1 = new Posting();
	posting1.account = result.toAccount ?? 'Expenses:Unknown';
	posting1.amount = result.amount ?? 0;
	posting1.currency = result.currency ?? options.defaultCurrency?.trim().toUpperCase() ?? 'EUR';

	const posting2 = new Posting();
	posting2.account = result.fromAccount ?? 'Assets:Unknown';

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
