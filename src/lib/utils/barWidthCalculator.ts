const MIN_PERCENTAGE_WIDTH = 2;
const MAX_PERCENTAGE_WIDTH = 100;

export function getBarWidth(amount: number, maxBalance: number): number {
	if (amount === 0) return 0;
	if (isNaN(amount) || maxBalance === 0) return MIN_PERCENTAGE_WIDTH;

	const ratio = Math.abs(amount) / Math.abs(maxBalance);
	const scaled = Math.pow(ratio, 0.5) * (MAX_PERCENTAGE_WIDTH - MIN_PERCENTAGE_WIDTH) + MIN_PERCENTAGE_WIDTH;
	return Math.min(MAX_PERCENTAGE_WIDTH, Math.max(MIN_PERCENTAGE_WIDTH, scaled));
}
