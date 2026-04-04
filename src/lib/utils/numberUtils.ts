/**
 * Adds numbers, keeping the precision of the decimal parts by treating them as integers.
 * @param nums 
 * @returns The sum of the numbers
 */
export function addDecimalStrings(nums: string[]): number {
    // Find the max number of decimal places across all inputs
    const maxDecimals = nums.reduce((max, n) => {
        const parts = n.split(".");
        return Math.max(max, parts[1]?.length ?? 0);
    }, 0);

    const factor = 10 ** maxDecimals;

    // Multiply to integers, sum, then divide back
    const sum = nums.reduce((acc, n) => acc + Math.round(parseFloat(n) * factor), 0);
    return sum / factor;
}