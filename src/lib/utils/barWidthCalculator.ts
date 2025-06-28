export const LOG_SCALE_FACTOR = 0.01;
const MIN_PERCENTAGE_WIDTH = 2; // Minimum width for the smallest bar (e.g., 20 pixels)
const MAX_PERCENTAGE_WIDTH = 100; // Maximum width for the largest bar

export function getBarWidth(amount: number, minBalance: number, maxBalance: number): number {
	if (amount === 0) return 0;
	if (isNaN(amount) || maxBalance === 0) return MIN_PERCENTAGE_WIDTH;

	const logAmount = Math.log(Math.abs(amount) * LOG_SCALE_FACTOR + 1);
	const logMinBalance = Math.log(minBalance * LOG_SCALE_FACTOR + 1);
	const logMaxBalanceAdjusted = Math.log(maxBalance * LOG_SCALE_FACTOR + 1);

	// Handle the case where minBalance and maxBalance are the same (e.g., only one account or all accounts have the same balance)
	if (logMaxBalanceAdjusted === logMinBalance) {
		return MAX_PERCENTAGE_WIDTH;
	}

	const scaledWidth =
		((logAmount - logMinBalance) / (logMaxBalanceAdjusted - logMinBalance)) *
			(MAX_PERCENTAGE_WIDTH - MIN_PERCENTAGE_WIDTH) +
		MIN_PERCENTAGE_WIDTH;

	return Math.max(MIN_PERCENTAGE_WIDTH, scaledWidth);
}
