/**
 * State store for the app
 */
import type internal from 'stream';
import { writable, type Writable } from 'svelte/store';

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

export const xact: Writable<undefined | object> = writable(undefined)