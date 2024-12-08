import type { Money, Xact } from "$lib/data/model";
import moment from "moment";

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

export function getMoneyColour(money: Money): string | undefined {
  if (!money) return;

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

/**
 * Returns the colour based on whether the date is due or not.
 * @param dateString the Skeleton text colour name
 */
export function getDateColour(dateString: string): string | undefined {
  const date = moment(dateString).toDate()
  const today = moment().startOf('day').toDate()

  if(date < today) {
    // red
    return 'text-secondary-400'
  }
  if(date === today) {
    // yellow
    return 'text-base-400'
  }
  if(date > today) {
    // green
    return 'text-primary-400'
  }
}

/**
 * One place to control the number formatting.
 * @param amount amount to format
 * @returns string, the number formatted to the app-wide standard.
 */
export function formatAmount(amount: number): string {
  if (!amount) {
    return ''
  } else {
    return amount.toLocaleString('en-UK')
  }
}