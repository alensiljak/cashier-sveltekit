/*
    Journal
*/

import db from '$lib/data/db';

export async function load() {
	console.log('loading data');
	const xacts = await db.xacts.orderBy('date').toArray();

	return { xacts };
}
