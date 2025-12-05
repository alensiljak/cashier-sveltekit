import appService from '$lib/services/appService';
import { get } from 'svelte/store';
import { ScheduledXact } from '$lib/data/mainStore';

/**
 * Load data used in the page.
 * @returns
 */
export async function load({ params }) {
	// if there is an Id, and no record, load the transaction.
	await loadData(params.id);
}

async function loadData(id?: string) {
	if (!id) return;

	// empty id is sent as "null"
	const sxId = Number(id);
	if (isNaN(sxId)) {
		console.warn('specified id is not numeric');
		return;
	}

	// If the transaction is already loaded, do not reload it.
	// This allows us to return from sub-pages (like delete postings) without losing changes.
	const currentScx = get(ScheduledXact);
	if (currentScx && currentScx.id === sxId) {
		return;
	}

	await appService.loadScheduledXact(sxId);
}
