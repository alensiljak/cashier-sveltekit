import type { Money, Xact } from "$lib/data/model";

const RED = 'text-red-500'
const YELLOW = 'text-yellow-500'
const GREEN = 'text-green-500'

/**
 * 
 * @param xact Xact for which to retrieve the total amount.
 * @param amount 
 */
export function getXactAmountColour(xact: Xact, balance: Money) {

    let colour = ''

    // Transfers, yellow
    if (xact.postings.filter((posting) => posting.account?.startsWith('Assets:')).length == 2) {
        // 2 Asset accounts. Assume transfer.
        colour = YELLOW
    } else {
      colour = getAmountColour(balance.amount)
    }
    return colour
}

export function getMoneyColour(money: Money) {
  return getAmountColour(money.amount)
}

export function getAmountColour(amount: number) {
  let colour = ''

  if (amount < 0) {
    colour = RED
  } else if (amount == 0) {
    colour = YELLOW
  } else if (amount > 0) {
    colour = GREEN
  }

  return colour
}
