import type { Money, Xact } from '$lib/data/model';
import moment from 'moment';

const RED = 'text-error';
const YELLOW = 'text-warning';
const GREEN = 'text-success';

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
		return 'text-secondary-content';
	}
	if (date === today) {
		// yellow
		return 'text-base-content';
	}
	if (date > today) {
		// green
		return 'text-primary-content';
	}
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
