import type { Money, Xact } from '$lib/data/model';
import moment from 'moment';

const RED = 'text-red-500';
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
	if (date === today) {
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
 */
export function getReadableDate(dateString: string): string {
	const date = moment(dateString);
	return date.format('MMM DD');
}

/**
 * One place to control the number formatting.
 * @param amount amount to format
 * @returns string, the number formatted to the app-wide standard.
 */
export function formatAmount(amount: number): string {
	if (amount === null || amount === undefined) {
		return '';
	}

	// Check if it's a whole number
	if (amount % 1 === 0) {
		return amount.toLocaleString('en-UK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
	}

	// const amountStr = String(amount);
	// const decimalPlaces = amountStr.split('.')[1]?.length || 0;

	const numberOptions = {
		minimumFractionDigits: 2,
		// maximumFractionDigits: Math.max(2, decimalPlaces)
	};

	return amount.toLocaleString('en-UK', numberOptions);
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
