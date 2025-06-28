/*
    Models used for intermediate data transfer.
*/

import type { Money } from './model';

/**
 * Used to pass the current value of all the accounts.
 * It is a dictionary with the account name as the key and
 * the current value as the value. The current value is
 * a Money object, representing the balance in the main currency.
 */
interface CurrentValuesDict {
	[account: string]: Money;
}

interface AccountWithBalance {
	name: string;
	balance: Money;
}

export type { CurrentValuesDict, AccountWithBalance };
