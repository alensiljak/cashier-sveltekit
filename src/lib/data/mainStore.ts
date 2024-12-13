/**
 * State store for the app
 */
import { writable, type Writable } from 'svelte/store';
import { ScheduledTransaction, Xact } from './model';
import type { SelectionModeMetadata } from '$lib/settings';
import type { AssetClass } from '$lib/AssetClass';

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

// Real items

export const xact: Writable<Xact> = writable()
export const ScheduledXact: Writable<ScheduledTransaction> = writable()
export const AssetAllocationStore: Writable<AssetClass[] | undefined> = writable()

export const selectionMetadata: Writable<SelectionModeMetadata | undefined> = writable()
