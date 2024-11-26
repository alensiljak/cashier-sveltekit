import type { Money, Xact } from "$lib/data/model";

/**
 * 
 * @param xact Xact for which to retrieve the total amount.
 * @param amount 
 */
export function getXactAmountColour(xact: Xact, balance: Money) {
    const RED = 'text-secondary-500' // red
    const YELLOW = 'text-tertiary-500' // yellow
    const GREEN = 'text-primary-500' // green

    let colour = ''

    // Transfers, yellow
    if (xact.postings.filter((posting) => posting.account?.startsWith('Assets:')).length == 2) {
        // 2 Asset accounts. Assume transfer.
        colour = YELLOW
    } else {
        if (balance.amount < 0) {
          colour = RED
        } else if (balance.amount == 0) {
          colour = YELLOW
        } else if (balance.amount > 0) {
          colour = GREEN
        }
    }
    return colour
}