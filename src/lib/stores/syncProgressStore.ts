/**
 * Store for tracking the progress of sync steps.
 */
import { writable } from 'svelte/store';

export interface SyncStep {
	id: number;
	name: string;
	status: 'pending' | 'in-progress' | 'completed' | 'error';
}

export const syncProgress = writable<SyncStep[]>([]);

/**
 * Initialize the sync progress store with the default steps.
 */
export function initializeSyncProgress() {
	syncProgress.set([
		{ id: 1, name: 'Sync accounts', status: 'pending' },
		{ id: 2, name: 'Sync opening balances', status: 'pending' },
		{ id: 3, name: 'Sync asset allocation', status: 'pending' },
		{ id: 4, name: 'Sync account balances', status: 'pending' },
		{ id: 5, name: 'Sync payees', status: 'pending' }
	]);
}

/**
 * Update the status of a sync step.
 */
export function updateSyncStep(id: number, status: SyncStep['status']) {
	syncProgress.update((steps) =>
		steps.map((step) => (step.id === id ? { ...step, status } : step))
	);
}

/**
 * Reset all sync steps to 'pending'.
 */
export function resetSyncProgress() {
	syncProgress.update((steps) => steps.map((step) => ({ ...step, status: 'pending' })));
}
