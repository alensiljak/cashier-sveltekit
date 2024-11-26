import type { Money, Xact } from "$lib/data/model";

/**
 * 
 * @param xact Xact for which to retrieve the total amount.
 * @param amount 
 */
export function getXactAmountColour(xact: Xact, balance: Money) {
    const RED = 'text-red-500'
    const YELLOW = 'text-yellow-500'
    const GREEN = 'text-green-500'

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
