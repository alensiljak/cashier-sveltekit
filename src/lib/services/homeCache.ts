/**
 * Stale-while-revalidate cache for home page cards.
 * Persists last-known balances and journal entries in localStorage so the UI
 * can render immediately on app open while the WASM ledger loads in the background.
 */

const CACHE_KEY = 'cashier:home-cache';
const CACHE_VERSION = 1;

export interface CachedBalance {
	quantity: number | null;
	currency: string;
}

export interface CachedFavouriteAccount {
	name: string;
	balance: CachedBalance | null;
	balances: Record<string, number> | null;
}

export interface CachedJournalEntry {
	date: string;
	payee: string;
	note: string;
	flag: string;
	postings: { account: string; amount: number; currency: string }[];
	xactAmount: CachedBalance;
}

interface HomePageCache {
	version: typeof CACHE_VERSION;
	timestamp: number;
	favouriteAccounts?: CachedFavouriteAccount[];
	journalEntries?: CachedJournalEntry[];
	/** Per-account current balance in default currency, keyed by account name. */
	forecastBalances?: Record<string, number>;
}

function load(): HomePageCache | null {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as HomePageCache;
		if (parsed.version !== CACHE_VERSION) return null;
		return parsed;
	} catch {
		return null;
	}
}

function patch(update: Partial<Omit<HomePageCache, 'version' | 'timestamp'>>): void {
	const existing = load() ?? { version: CACHE_VERSION as typeof CACHE_VERSION, timestamp: 0 };
	const updated: HomePageCache = {
		...existing,
		...update,
		version: CACHE_VERSION,
		timestamp: Date.now()
	};
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(updated));
	} catch {
		// localStorage full or unavailable — silently ignore
	}
}

export const homeCache = {
	getFavouriteAccounts(): CachedFavouriteAccount[] | null {
		return load()?.favouriteAccounts ?? null;
	},
	saveFavouriteAccounts(accounts: CachedFavouriteAccount[]): void {
		patch({ favouriteAccounts: accounts });
	},

	getJournalEntries(): CachedJournalEntry[] | null {
		return load()?.journalEntries ?? null;
	},
	saveJournalEntries(entries: CachedJournalEntry[]): void {
		patch({ journalEntries: entries });
	},

	getForecastBalances(): Record<string, number> | null {
		return load()?.forecastBalances ?? null;
	},
	saveForecastBalances(balances: Record<string, number>): void {
		patch({ forecastBalances: balances });
	}
};
