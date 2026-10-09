import appService from '#lib/services/appService';
import { get } from 'svelte/store';
import { ScheduledXact } from '#lib/data/mainStore';
import type { PageLoad } from './$types';

/**
 * Load data used in the page.
 * @returns
 */
export const load: PageLoad = async ({ params }) => {
	// if there is an Id, and no record, load the transaction.
	await loadData(params.id);
};

async function loadData(id?: string) {
	// empty id is sent as "null"
	if (!id || id === 'null') return;

	// If the transaction is already loaded, do not reload it.
	// This allows us to return from sub-pages (like delete postings) without losing changes.
	const currentScx = get(ScheduledXact);
	if (currentScx && currentScx.id === id) {
		return;
	}

	await appService.loadScheduledXact(id);
}
