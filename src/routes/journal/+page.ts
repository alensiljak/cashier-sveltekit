/*
    Journal
*/

import db from '$lib/data/db';
import appServiceOpfs from '$lib/services/appServiceOpfs';

export async function load() {
	console.log('loading data');
	const xacts = await db.xacts.orderBy('date').toArray();
	const opfsXacts = await appServiceOpfs.loadXacts();

	return { xacts, opfsXacts };
}
