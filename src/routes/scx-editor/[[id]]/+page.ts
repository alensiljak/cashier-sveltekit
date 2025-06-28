import appService from '$lib/services/appService';

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

	await appService.loadScheduledXact(sxId);
}
