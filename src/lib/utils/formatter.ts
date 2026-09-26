import type { Money, Posting, Xact } from '$lib/data/model';
import moment from 'moment';

const RED = 'text-red-400';
const YELLOW = 'text-yellow-200';
const GREEN = 'text-green-500';

/**
 *
 * @param xact Xact for which to retrieve the total amount.
 * @param amount
 */
export function getXactAmountColour(xact: Xact, balance: Money) {
	let colour = '';

	// Transfers, yellow
	if (xact.postings.filter((posting) => posting.account?.startsWith('Assets:')).length == 2) {
		// 2 Asset accounts. Assume transfer.
		colour = YELLOW;
	} else {
		colour = getAmountColour(balance.quantity);
	}
	return colour;
}

export function getMoneyColour(money: Money): string | undefined {
	if (!money) return;

	return getAmountColour(money.quantity);
}

/**
 * Colorize the Money values based on the amount (red <0, yellow 0, green >0).
 * @param amount The amount to base the color upon.
 * @returns The DaisyUI/Tailwind color string, to be used in the container class.
 */
export function getAmountColour(amount: number): string {
	let colour = '';

	if (amount < 0) {
		colour = RED;
	} else if (amount == 0) {
		colour = YELLOW;
	} else if (amount > 0) {
		colour = GREEN;
	}

	return colour;
}

/**
 * Returns the colour based on whether the date is due or not.
 * @param dateString the DaisyUI text colour name
 */
export function getDateColour(dateString: string): string | undefined {
	const date = moment(dateString).toDate();
	const today = moment().startOf('day').toDate();

	if (date < today) {
		// red
		return 'text-secondary-400';
	}
	// Compare by value: two Date objects are never `===`.
	if (date.getTime() === today.getTime()) {
		// yellow
		return 'text-neutral';
	}
	if (date > today) {
		// green
		return 'text-primary-400';
	}
}

/**
 * Converts the ISO date to a readable date, only shorter
 * @param dateString ISO date string, '2025-12-07'
 * @param format moment.js format string; defaults to 'MMM DD'
 */
export function getReadableDate(dateString: string, format = 'MMM DD'): string {
	const date = moment(dateString);
	return date.format(format);
}

/**
 * One place to control the number formatting.
 * Always shows at least 2 decimals, so amounts line up in columns ("1,234.00"),
 * and up to `maxDecimals` (default 4) so quantities like 12.3456 are not rounded.
 * Compact views such as the home cards pass 2.
 * @param amount amount to format
 * @param maxDecimals most fraction digits to show; at least 2
 * @returns string, the number formatted to the app-wide standard.
 */
export function formatAmount(amount: number, maxDecimals = 4): string {
	if (amount === null || amount === undefined) {
		return '';
	}

	return amount.toLocaleString('en-GB', {
		minimumFractionDigits: 2,
		maximumFractionDigits: Math.max(2, maxDecimals)
	});
}

/**
 * Format the cost annotation of a posting for display, e.g. `{13.20 EUR}`.
 * Returns an empty string when the posting has no cost.
 */
export function formatPostingCost(posting: Posting): string {
	if (posting.costAmount == null || !posting.costCurrency) {
		return '';
	}
	return `{${posting.costAmount} ${posting.costCurrency}}`;
}

/**
 * Format the price annotation of a posting for display,
 * e.g. `@ 1.95 EUR` (unit price) or `@@ 17.9 EUR` (total price).
 * Returns an empty string when the posting has no price.
 */
export function formatPostingPrice(posting: Posting): string {
	if (posting.priceAmount == null || !posting.priceCurrency) {
		return '';
	}
	const op = posting.totalPrice ? '@@' : '@';
	return `${op} ${posting.priceAmount} ${posting.priceCurrency}`;
}

export function getColourForYield(amount: string): string {
	if (!amount) return '';

	amount = amount.substring(0, amount.length - 1);
	const number = Number(amount);
	return getAmountColour(number);
}

export function getColourForGainLoss(gainloss: string): string {
	if (!gainloss) {
		return '';
	}

	const parts = gainloss.split(' ');
	const amountPart = Number(parts[0]);
	const colour = getAmountColour(amountPart);
	return colour;
}
