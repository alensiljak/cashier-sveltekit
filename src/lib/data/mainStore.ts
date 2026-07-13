/**
 * State store for the app
 */
import { writable, type Writable } from 'svelte/store';
import { ScheduledTransaction, Xact } from './model';
import type { SelectionModeMetadata } from '$lib/settings';
import type { AssetClass, StockCache } from '$lib/assetAllocation/AssetClass';
import type { DirectiveSpan } from '$lib/rledger/sourceEditor';
import { SHORT_DATE_FORMAT_DEFAULT } from '$lib/constants';
import type { GroupRow, SecurityIrrEntry } from '$lib/portfolioReturns/types';

interface MainStore {
	name: string;
	age: number;
	address: string;
	count: number;
	xact: object;
}

export const state: Writable<Partial<MainStore>> = writable({
	count: 0,
	xact: undefined
});

// Store items.

export const selectionMetadata: Writable<SelectionModeMetadata | undefined> = writable();
export const postingEditorIndex: Writable<number> = writable(0);
export const DefaultCurrencyStore: Writable<string> = writable();
export const xact: Writable<Xact> = writable();
/** The DirectiveSpan of the transaction currently being edited. Undefined for new transactions. */
export const xactSpan: Writable<DirectiveSpan | undefined> = writable(undefined);
export const ScheduledXact: Writable<ScheduledTransaction> = writable();
// asset allocation
export const AssetAllocationStore: Writable<AssetClass[] | undefined> = writable();
export const AaStocksStore: Writable<StockCache | undefined> = writable();
export const AssetAllocationLoadedAtStore: Writable<Date | undefined> = writable();
// Portfolio Returns / per-security IRR caches. Keyed by the selected period ('last12',
// '<year>', or 'all') since XIRR results depend on the report window, not just on ledger
// content. Cleared by Asset Allocation's "Refresh" action, same invalidation convention as
// AssetAllocationStore/AaStocksStore — there is no automatic staleness detection on ledger
// sync, matching the existing AA cache's behavior.
export const PortfolioReturnsCacheStore: Writable<
	Record<string, Record<string, GroupRow>> | undefined
> = writable();
export const SecurityIrrCacheStore: Writable<
	Record<string, Record<string, SecurityIrrEntry>> | undefined
> = writable();
// Drawer/sidebar store.
export const drawerState: Writable<boolean> = writable(false);
// Whether the sidebar nav is pinned open on desktop (lg+). Persisted so the
// preference survives reloads; toggled from the nav's collapse button and
// the Toolbar hamburger (which doubles as the "show" action once hidden).
const DESKTOP_NAV_VISIBLE_KEY = 'desktopNavVisible';
function createDesktopNavVisibleStore(): Writable<boolean> {
	const initial =
		typeof localStorage === 'undefined'
			? true
			: (localStorage.getItem(DESKTOP_NAV_VISIBLE_KEY) ?? 'true') === 'true';
	const store = writable<boolean>(initial);
	store.subscribe((value) => {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(DESKTOP_NAV_VISIBLE_KEY, String(value));
		}
	});
	return store;
}
export const desktopNavVisible: Writable<boolean> = createDesktopNavVisibleStore();
// Full-text search box value on /search/full-text — kept for the session only (module
// state, not persisted) so navigating to a result and back leaves it intact.
export const SearchTermStore: Writable<string> = writable('');
// Entity search box value/scope on /search (BQL-backed payee/account/narration/
// commodity search) — kept for the session only (module state, not persisted)
// so navigating to a result and back leaves the previous query intact.
export type EntitySearchScope = 'all' | 'payees' | 'accounts' | 'narration' | 'commodities';
export const EntitySearchTermStore: Writable<string> = writable('');
export const EntitySearchScopeStore: Writable<EntitySearchScope> = writable('all');
// Selected month key on /budget (e.g. '2026-07') — kept for the session only
// (module state, not persisted) so navigating to a transaction search result
// and back leaves the previously selected month intact.
export const BudgetSelectedMonthStore: Writable<string | undefined> = writable(undefined);
// Selected year key on /budget (e.g. '2026') when the Year view is active —
// same session-only rationale as BudgetSelectedMonthStore.
export const BudgetSelectedYearStore: Writable<string | undefined> = writable(undefined);
// Month/Year toggle state on /budget — kept for the session only so
// navigating away and back preserves the chosen view.
export type BudgetViewMode = 'month' | 'year';
export const BudgetViewModeStore: Writable<BudgetViewMode> = writable('month');

export interface PendingSettings {
	currency?: string;
	bookFilename?: string | null;
	assetAllocationDefinition?: string | null;
	rootInvestmentAccount?: string;
	dateFormat?: string;
	shortDateFormat?: string;
}

export const PendingSettingsStore: Writable<PendingSettings | undefined> = writable(undefined);

export { SHORT_DATE_FORMAT_DEFAULT };
export const ShortDateFormatStore: Writable<string> = writable(SHORT_DATE_FORMAT_DEFAULT);
