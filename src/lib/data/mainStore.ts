/**
 * State store for the app
 */
import { writable, type Writable } from 'svelte/store';
import { ScheduledTransaction, Xact } from './model';
import type { SelectionModeMetadata } from '$lib/settings';
import type { AssetClass, StockCache } from '$lib/assetAllocation/AssetClass';
import type { DirectiveSpan } from '$lib/rledger/sourceEditor';
import { SHORT_DATE_FORMAT_DEFAULT } from '$lib/constants';

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
// Full-text search box value on /search — kept for the session only (module
// state, not persisted) so navigating to a result and back leaves it intact.
export const SearchTermStore: Writable<string> = writable('');
// Selected month key on /budget (e.g. '2026-07') — kept for the session only
// (module state, not persisted) so navigating to a transaction search result
// and back leaves the previously selected month intact.
export const BudgetSelectedMonthStore: Writable<string | undefined> = writable(undefined);

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
