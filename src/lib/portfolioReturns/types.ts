/**
 * Shared row/cache-entry shapes for Portfolio Returns and per-security IRR, so both the
 * report pages and the mainStore cache declarations can agree on a type without importing
 * a Svelte component's `<script>` block.
 *
 * Both caches are keyed first by the selected report period ('last12', '<year>', or 'all'),
 * then by group/symbol name — a `Record<periodKey, Record<name, Entry>>` — so switching
 * periods doesn't evict results for periods already computed this session.
 */
export interface GroupRow {
	name: string;
	/** null while the market-value phase hasn't resolved yet. */
	marketValue: number | null;
	irrPct: number | null;
	/** Set when xirr() couldn't solve for this group (e.g. too little history). */
	irrError: string | null;
	/** Days between the earliest and latest cash flow feeding the XIRR solve. A short span
	 *  (e.g. a position opened days before the window's end) means `irrPct` is a real but
	 *  heavily annualized number — the UI should caveat it, not treat it as a plain "return". */
	irrHoldingDays: number | null;
	conversionWarnings: string[];
	loadingMarketValue: boolean;
	loadingFlows: boolean;
}

/** A cached per-security IRR result (no `loading` flag — that's transient UI state, not
 *  something worth caching). */
export interface SecurityIrrEntry {
	irrPct: number | null;
	irrError: string | null;
	irrHoldingDays: number | null;
}
