import { AssetClass } from './AssetClass.js';

/**
 * Returns the appropriate Tailwind text color class based on the offset value.
 * @param value - The offset percentage value
 * @returns Tailwind CSS color class
 */
export function getOffsetColor(value: number): string {
	if (value <= -20) {
		return 'text-red-700';
	}
	if (-20 < value && value < 0) {
		return 'text-red-300';
	}
	if (0 < value && value < 20) {
		return 'text-green-300';
	}
	if (value >= 20) {
		return 'text-green-700';
	}
	return '';
}

/**
 * Returns the appropriate Tailwind background color class for a row based on asset class depth.
 * @param ac - The AssetClass to determine row color for
 * @returns Tailwind CSS background color class
 */
export function getRowColor(ac: AssetClass): string {
	// Asset classes with symbols are leaf nodes and don't get background coloring
	if (ac.symbols?.length) {
		return '';
	}

	const depth = ac.depth;
	// root
	if (depth === 0) {
		return 'bg-gray-600';
	}
	// equity/fixed/real
	if (depth === 1) {
		return 'bg-gray-700';
	}
	// area
	if (depth === 2) {
		return 'bg-gray-800';
	}
	return '';
}

/**
 * Builds a children index for efficient child lookups in hierarchical asset allocation data.
 * @param assetClasses - Array of AssetClass objects
 * @returns Map where keys are parent names and values are arrays of child AssetClasses
 */
export function buildChildrenIndex(assetClasses: AssetClass[]): Map<string, AssetClass[]> {
	const childrenIndex = new Map<string, AssetClass[]>();

	for (let i = 0; i < assetClasses.length; i++) {
		const ac = assetClasses[i];
		const parentName = ac.parentName;

		if (!childrenIndex.has(parentName)) {
			childrenIndex.set(parentName, []);
		}

		childrenIndex.get(parentName)?.push(ac);
	}

	return childrenIndex;
}
