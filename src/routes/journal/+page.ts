/*
    Journal
*/

import db from "$lib/data/db";

export async function load() {
    const xacts = await db.xacts.orderBy('date').toArray();
    
    return { xacts }
}
