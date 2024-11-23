/**
 * State store for the app
 */
import { writable, type Writable } from 'svelte/store';
import { Transaction } from './model';
import type { SelectionModeMetadata } from '$lib/settings';

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

export const xact: Writable<Transaction> = writable()

export const selectionMetadata: Writable<SelectionModeMetadata | null> = writable()
