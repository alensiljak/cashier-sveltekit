/*
	Ledger-aware resolution of a parsed phrase. The parser (`nlpEntry.ts`) only knows words;
	this module matches them against what is actually in the book: the payee against known
	payees (fuzzy, since speech-to-text mishears names) and the accounts against that payee's
	history (a payee like Lidl maps to several accounts, so context words and usage decide).

	Pure apart from the injected `EntityLookup`, which supplies the ledger data (BQL in the
	app, a fake in tests).
*/
import {
	STOP_WORDS,
	type FieldResolution,
	type ParseResult,
	type ResolvableField
} from '#lib/utils/nlpEntry';

/** One posting seen in history for a payee. */
export interface PostingObservation {
	account: string;
	date: string;
	amount?: number;
}

/** Ledger data the resolver needs. */
export interface EntityLookup {
	/** Distinct payee names. */
	listPayees(): Promise<string[]>;
	/** Postings (expense, asset, liability, income side) of transactions with this exact payee. */
	payeePostings(payee: string): Promise<PostingObservation[]>;
	/** Open account names. */
	listAccounts(): Promise<string[]>;
}

export interface AccountStat {
	account: string;
	count: number;
	lastDate: string;
	/** Median absolute amount, when any posting had one. */
	typicalAmount?: number;
}

const PAYEE_THRESHOLD = 0.75;
/** A history leader must hold at least this share of the weight to be picked without review. */
const CLEAR_LEADER_SHARE = 0.7;
const MAX_ALTERNATIVES = 4;

const FILLER_WORDS = new Set(['on', 'in', 'with', 'of', 'by', 'via', 'into', 'using', 'and']);

// --- Text helpers ------------------------------------------------------------

/** Lowercases, strips diacritics and punctuation; words are single-space separated. */
export function normalizeName(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		for (let j = 1; j <= b.length; j++) {
			cur[j] = Math.min(
				prev[j]! + 1,
				cur[j - 1]! + 1,
				prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
		}
		prev = cur;
	}
	return prev[b.length]!;
}

function editSimilarity(a: string, b: string): number {
	const longest = Math.max(a.length, b.length);
	return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

/** Similarity 0..1 of a normalized query to a normalized candidate name. */
function nameScore(query: string, candidate: string): number {
	if (query === candidate) return 1;
	const qTokens = query.split(' ');
	const cTokens = candidate.split(' ');
	let best = editSimilarity(query, candidate);

	if (query.length >= 3 && candidate.startsWith(query)) best = Math.max(best, 0.9);
	// Every spoken word starts some word of the name ("deca hik" -> "decathlon hiking").
	if (qTokens.every((q) => q.length >= 3 && cTokens.some((c) => c.startsWith(q)))) {
		best = Math.max(best, 0.88);
	}
	// A single spoken word against one word of a multi-word name ("rewe" -> "rewe markt").
	if (qTokens.length === 1 && cTokens.length > 1) {
		for (const c of cTokens) best = Math.max(best, 0.9 * editSimilarity(query, c));
	}
	return best;
}

// --- Payee matching ------------------------------------------------------------

export interface PayeeMatch {
	name: string;
	score: number;
	/** The spoken words (indices into the query tokens) the match consumed. */
	start: number;
	end: number;
	alternatives: string[];
}

/**
 * Finds the known payee that best matches a run of the spoken payee words. Every contiguous
 * window of words is tried, so "deca t-shirt" can resolve to Decathlon and leave "t-shirt"
 * for the note. Higher score wins; on a tie the longer window, then the shorter name.
 */
export function matchPayee(words: string[], payees: string[]): PayeeMatch | undefined {
	const normalized = payees.map((p) => ({ name: p, norm: normalizeName(p) }));
	let best: (PayeeMatch & { nameLen: number }) | undefined;

	for (let len = words.length; len >= 1; len--) {
		for (let start = 0; start + len <= words.length; start++) {
			const query = normalizeName(words.slice(start, start + len).join(' '));
			if (query.length < 2 || !/[a-z]/.test(query)) continue;

			const scored = normalized
				.map((p) => ({ name: p.name, norm: p.norm, score: nameScore(query, p.norm) }))
				.filter((s) => s.score >= PAYEE_THRESHOLD)
				.sort((a, b) => b.score - a.score || a.norm.length - b.norm.length);
			const top = scored[0];
			if (!top) continue;

			const better =
				!best ||
				top.score > best.score + 1e-9 ||
				(Math.abs(top.score - best.score) < 1e-9 && len > best.end - best.start);
			if (better) {
				best = {
					name: top.name,
					score: top.score,
					nameLen: top.norm.length,
					start,
					end: start + len,
					alternatives: scored
						.slice(1)
						.filter((s) => top.score - s.score <= 0.05)
						.slice(0, MAX_ALTERNATIVES - 1)
						.map((s) => s.name)
				};
			}
		}
	}
	if (!best) return undefined;
	const { nameLen: _nameLen, ...match } = best;
	return match;
}

// --- Account matching ------------------------------------------------------------

/** Words of an account's segments: "Expenses:Auto:EVCharging" -> expenses, auto, ev, charging, evcharging. */
function accountWords(account: string): string[] {
	const words = new Set<string>();
	for (const segment of account.split(':')) {
		const whole = normalizeName(segment);
		if (whole) words.add(whole);
		for (const part of normalizeName(segment.replace(/([a-z])([A-Z])/g, '$1 $2')).split(' ')) {
			if (part) words.add(part);
		}
	}
	return [...words];
}

function sharedPrefix(a: string, b: string): number {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	return i;
}

/** True when a spoken word names an account word: equal, or a long shared stem ("grocery"/"groceries"). */
function wordMatches(word: string, accountWord: string): boolean {
	if (word.length < 3 || accountWord.length < 3) return false;
	if (word === accountWord) return true;
	const shortest = Math.min(word.length, accountWord.length);
	return sharedPrefix(word, accountWord) >= Math.max(4, Math.ceil(0.7 * shortest));
}

function matchesContext(account: string, context: string[]): boolean {
	const words = accountWords(account);
	return context.some((c) => words.some((w) => wordMatches(c, w)));
}

/**
 * Finds the account a short spoken/parsed name refers to ("savings", "n26 savings",
 * "Groceries"), among `accounts`. Every word of the name must hit some account word.
 */
export function matchAccountName(
	name: string,
	accounts: string[]
):
	| (FieldResolution & {
			account: string;
	  })
	| undefined {
	const tokens = normalizeName(name)
		.split(' ')
		.filter((t) => t.length >= 2);
	if (tokens.length === 0) return undefined;

	const scored: Array<{ account: string; score: number }> = [];
	for (const account of accounts) {
		const words = accountWords(account);
		let total = 0;
		let all = true;
		for (const token of tokens) {
			const exact = words.some((w) => w === token);
			const loose = !exact && words.some((w) => wordMatches(token, w));
			if (!exact && !loose) {
				all = false;
				break;
			}
			total += exact ? 1 : 0.8;
		}
		if (all) scored.push({ account, score: total / tokens.length });
	}
	if (scored.length === 0) return undefined;

	// Best score first; among equals the shallowest, then shortest, name.
	scored.sort(
		(a, b) =>
			b.score - a.score ||
			a.account.split(':').length - b.account.split(':').length ||
			a.account.length - b.account.length
	);
	const top = scored[0]!;
	const rivals = scored.filter((s) => s.score === top.score);
	return {
		account: top.account,
		kind: rivals.length > 1 ? 'ambiguous' : top.score === 1 ? 'exact' : 'fuzzy',
		alternatives: rivals.length > 1 ? rivals.slice(0, MAX_ALTERNATIVES).map((s) => s.account) : []
	};
}

// --- History statistics ------------------------------------------------------------

function median(values: number[]): number | undefined {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Groups postings by account for accounts starting with one of `prefixes`. */
export function aggregateAccounts(obs: PostingObservation[], prefixes: string[]): AccountStat[] {
	const byAccount = new Map<string, { count: number; lastDate: string; amounts: number[] }>();
	for (const o of obs) {
		if (!prefixes.some((p) => o.account.startsWith(p))) continue;
		const entry = byAccount.get(o.account) ?? { count: 0, lastDate: '', amounts: [] };
		entry.count += 1;
		if (o.date > entry.lastDate) entry.lastDate = o.date;
		if (o.amount !== undefined && Number.isFinite(o.amount)) entry.amounts.push(Math.abs(o.amount));
		byAccount.set(o.account, entry);
	}
	return [...byAccount.entries()].map(([account, e]) => ({
		account,
		count: e.count,
		lastDate: e.lastDate,
		typicalAmount: median(e.amounts)
	}));
}

function weightOf(stat: AccountStat, amount: number | undefined, now: Date): number {
	const ageYears = stat.lastDate
		? Math.max(0, (now.getTime() - new Date(stat.lastDate).getTime()) / (365 * 864e5))
		: 0;
	let weight = stat.count * Math.pow(0.5, Number.isFinite(ageYears) ? ageYears : 0);
	if (amount && stat.typicalAmount) {
		const ratio = Math.min(amount, stat.typicalAmount) / Math.max(amount, stat.typicalAmount);
		weight *= 0.5 + 0.5 * ratio;
	}
	return weight;
}

/**
 * Picks the account for a payee from its history. Accounts whose name matches a context word
 * win; otherwise usage (count, recency, typical amount) decides. A leader with less than
 * `CLEAR_LEADER_SHARE` of the weight is reported as ambiguous.
 */
export function rankAccounts(
	stats: AccountStat[],
	options: { context?: string[]; amount?: number; now?: Date } = {}
): (FieldResolution & { account: string }) | undefined {
	if (stats.length === 0) return undefined;
	const now = options.now ?? new Date();
	const hits = options.context?.length
		? stats.filter((s) => matchesContext(s.account, options.context!))
		: [];
	const pool = hits.length > 0 ? hits : stats;

	const ranked = pool
		.map((s) => ({ account: s.account, weight: weightOf(s, options.amount, now) }))
		.sort((a, b) => b.weight - a.weight || a.account.localeCompare(b.account));
	const total = ranked.reduce((sum, r) => sum + r.weight, 0);
	const top = ranked[0]!;
	const clear = ranked.length === 1 || top.weight / total >= CLEAR_LEADER_SHARE;

	return {
		account: top.account,
		kind: !clear ? 'ambiguous' : hits.length > 0 ? 'exact' : 'guessed',
		alternatives: ranked.length > 1 ? ranked.slice(0, MAX_ALTERNATIVES).map((r) => r.account) : []
	};
}

/** Accounts a context word names outright ("with visa" -> Liabilities:CreditCard:Visa). */
function namedAccount(
	context: string[],
	accounts: string[]
): (FieldResolution & { account: string }) | undefined {
	const hits = accounts.filter((a) => {
		const words = accountWords(a);
		return context.some((c) => c.length >= 3 && words.includes(c));
	});
	if (hits.length === 0) return undefined;
	hits.sort((a, b) => a.split(':').length - b.split(':').length || a.length - b.length);
	return {
		account: hits[0]!,
		kind: hits.length === 1 ? 'exact' : 'ambiguous',
		alternatives: hits.length === 1 ? [] : hits.slice(0, MAX_ALTERNATIVES)
	};
}

// --- Orchestration ------------------------------------------------------------

const EXPENSE = ['Expenses:'];
const FUNDING = ['Assets:', 'Liabilities:'];
const INCOME = ['Income:'];

const isFallback = (account: string | undefined) => !account || account.endsWith(':Unknown');

/** Recomputes `needsReview` after resolution changed the fields it depends on. */
export function recomputeNeedsReview(result: ParseResult): void {
	const ambiguous = Object.values(result.resolution ?? {}).some((r) => r?.kind === 'ambiguous');
	result.needsReview =
		(!result.payee && !result.isTransfer) ||
		result.amount === undefined ||
		!result.fromAccountResolved ||
		!result.toAccountResolved ||
		ambiguous;
}

/** Applies a tapped alternative for `field` and clears its ambiguity. */
export function applyAlternative(result: ParseResult, field: ResolvableField, value: string): void {
	result[field] = value;
	if (field === 'toAccount') result.toAccountResolved = true;
	if (field === 'fromAccount') result.fromAccountResolved = true;
	result.resolution = {
		...result.resolution,
		[field]: { kind: 'exact', alternatives: result.resolution?.[field]?.alternatives ?? [] }
	};
	recomputeNeedsReview(result);
}

function contextWords(text: string, payeeWords: string[]): string[] {
	return normalizeName(text)
		.split(' ')
		.filter(
			(w) =>
				w.length >= 3 &&
				!/\d/.test(w) &&
				!STOP_WORDS.has(w) &&
				!FILLER_WORDS.has(w) &&
				!payeeWords.includes(w)
		);
}

/**
 * Resolves the payee and accounts of `result` against the ledger, in place. Parser guesses
 * that name accounts which do not exist in the book (e.g. the keyword map's `Expenses:Groceries`)
 * are looked up by name; payee history then decides the counter-accounts.
 */
export async function resolveEntities(
	result: ParseResult,
	text: string,
	lookup: EntityLookup,
	now: Date = new Date()
): Promise<void> {
	const resolution: NonNullable<ParseResult['resolution']> = {};
	let payeeWords: string[] = [];
	let payeeKnown = false;

	// Accounts are listed lazily, once.
	let accountsPromise: Promise<string[]> | undefined;
	const accounts = () => (accountsPromise ??= lookup.listAccounts());
	const withPrefix = async (prefixes: string[]) =>
		(await accounts()).filter((a) => prefixes.some((p) => a.startsWith(p)));
	const known = async (account: string) => (await accounts()).includes(account);

	// 1. Payee.
	if (!result.isTransfer && result.payee) {
		const spoken = result.payee.split(/\s+/);
		const match = matchPayee(spoken, await lookup.listPayees());
		if (match) {
			const outside = [...spoken.slice(0, match.start), ...spoken.slice(match.end)];
			if (outside.length > 0) {
				result._leftoverWords = [...(result._leftoverWords ?? []), ...outside];
				result.note = result._leftoverWords.join(' ');
			}
			payeeWords = normalizeName(spoken.slice(match.start, match.end).join(' ')).split(' ');
			result.payee = match.name;
			payeeKnown = true;
			const closeCall = match.score < 1 && match.alternatives.length > 0;
			resolution.payee = {
				kind: closeCall ? 'ambiguous' : match.score === 1 ? 'exact' : 'fuzzy',
				alternatives: [match.name, ...match.alternatives].slice(0, MAX_ALTERNATIVES)
			};
			result.matched.push(`payee match: ${match.name}`);
		}
	}

	const context = contextWords(text, payeeWords);
	const history = payeeKnown && result.payee ? await lookup.payeePostings(result.payee) : [];
	const needsLookup = async (account: string | undefined) =>
		!!account && !isFallback(account) && (!account.includes(':') || !(await known(account)));

	// Resolves a parser account that is a bare word ("checking") or a guess missing from the book.
	const lookUpGuess = async (field: 'fromAccount' | 'toAccount', prefixes: string[]) => {
		const current = result[field];
		if (!(await needsLookup(current))) return;
		const name = current!.slice(current!.lastIndexOf(':') + 1);
		const found = matchAccountName(name, await withPrefix(prefixes));
		if (!found) return;
		result[field] = found.account;
		resolution[field] = { kind: found.kind, alternatives: found.alternatives };
	};

	if (result.isTransfer) {
		await lookUpGuess('fromAccount', FUNDING);
		await lookUpGuess('toAccount', FUNDING);
	} else if (result.isIncome) {
		// fromAccount = the income source, toAccount = where the money lands.
		const source = aggregateAccounts(history, INCOME);
		if (
			isFallback(result.fromAccount) ||
			!result.fromAccountResolved ||
			!result.fromAccount?.includes(':')
		) {
			const pick = rankAccounts(source, { context, amount: result.amount, now });
			if (pick) {
				result.fromAccount = pick.account;
				result.fromAccountResolved = true;
				resolution.fromAccount = { kind: pick.kind, alternatives: pick.alternatives };
			}
		}
		if (isFallback(result.toAccount)) {
			const pick =
				namedAccount(context, await withPrefix(FUNDING)) ??
				rankAccounts(aggregateAccounts(history, FUNDING), { amount: result.amount, now });
			if (pick) {
				result.toAccount = pick.account;
				result.toAccountResolved = true;
				resolution.toAccount = { kind: pick.kind, alternatives: pick.alternatives };
			}
		} else {
			await lookUpGuess('toAccount', FUNDING);
		}
	} else {
		// Expense side: payee history (context words first), else look the parser's guess up by name.
		const pick = rankAccounts(aggregateAccounts(history, EXPENSE), {
			context,
			amount: result.amount,
			now
		});
		if (pick) {
			result.toAccount = pick.account;
			result.toAccountResolved = true;
			resolution.toAccount = { kind: pick.kind, alternatives: pick.alternatives };
		} else {
			await lookUpGuess('toAccount', EXPENSE);
		}

		// Paid-with side: an explicit "from checking" first, then a named account, then history.
		await lookUpGuess('fromAccount', FUNDING);
		if (isFallback(result.fromAccount)) {
			const fundingPick =
				namedAccount(context, await withPrefix(FUNDING)) ??
				rankAccounts(aggregateAccounts(history, FUNDING), { amount: result.amount, now });
			if (fundingPick) {
				result.fromAccount = fundingPick.account;
				result.fromAccountResolved = true;
				resolution.fromAccount = { kind: fundingPick.kind, alternatives: fundingPick.alternatives };
			}
		}
	}

	if (Object.keys(resolution).length > 0) {
		result.resolution = { ...result.resolution, ...resolution };
		recomputeNeedsReview(result);
	}
}
