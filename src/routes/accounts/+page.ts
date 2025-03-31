import CashierDAL from '$lib/data/dal';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
    const dal = new CashierDAL();
    let accounts = await dal.loadAccounts().toArray();

    return { accounts };
}
