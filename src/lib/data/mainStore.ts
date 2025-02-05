/**
 * State store for the app
 */
import { writable, type Writable } from 'svelte/store';
import { ScheduledTransaction, Xact } from './model';
import type { SelectionModeMetadata } from '$lib/settings';
import type { AssetClass, StockCache } from '$lib/assetAllocation/AssetClass';

interface MainStore {
    name: string;
    age: number;
    address: string;
    count: number;
    xact: object
}

export const state: Writable<Partial<MainStore>>
    = writable({
        count: 0,
        xact: undefined
    });

// Store items.

export const selectionMetadata: Writable<SelectionModeMetadata | undefined> = writable()
export const DefaultCurrencyStore: Writable<string> = writable()
export const xact: Writable<Xact> = writable()
export const ScheduledXact: Writable<ScheduledTransaction> = writable()
// asset allocation
export const AssetAllocationStore: Writable<AssetClass[] | undefined> = writable()
export const AaStocksStore: Writable<StockCache | undefined> = writable()
// Drawer/sidebar store.
export const drawerState: Writable<boolean> = writable(false);
