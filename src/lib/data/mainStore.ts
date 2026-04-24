/**
 * State store for the app
 */
import { writable, type Writable } from 'svelte/store';
import { ScheduledTransaction, Xact } from './model';
import type { SelectionModeMetadata } from '$lib/settings';
import type { AssetClass, StockCache } from '$lib/assetAllocation/AssetClass';
import type { DirectiveSpan } from '$lib/rledger/sourceEditor';

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

export interface PendingSettings {
	currency?: string;
	rememberLastTransaction?: boolean;
	bookFilename?: string | null;
	assetAllocationDefinition?: string | null;
	rootInvestmentAccount?: string;
}

export const PendingSettingsStore: Writable<PendingSettings | undefined> = writable(undefined);
