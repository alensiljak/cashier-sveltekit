/*
    Scheduled Transactions list
*/
import db from '$lib/data/db';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	let data = await loadData();
	return data;
};

async function loadData() {
	let sorted = await db.scheduled
		.orderBy('nextDate')
		//.sortBy('symbol')
		.toArray();

	// sort also by payee, case insensitive
	sorted.sort((a, b) => {
		const tx1 = a.transaction;
		const tx2 = b.transaction;

		var sorting = a.nextDate.localeCompare(b.nextDate);
		return sorting == 0
			? tx1.payee.localeCompare(tx2.payee, 'en', { sensitivity: 'base' })
			: sorting;
	});

	return { sorted };
}
