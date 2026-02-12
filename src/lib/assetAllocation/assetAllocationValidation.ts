/*
    validation
*/

import { AssetAllocationEngine } from './AssetAllocation';
import type { AssetClass } from './AssetClass';

/**
 * Validate Asset Allocation.
 * Currently checks the definition by comparing group sums.
 * @param engine AssetAllocationEngine instance
 */
export function validate(engine: AssetAllocationEngine) {
	const errors: string[] = [];
	const assetClassList = engine.assetClassIndex;
	const keys = Object.keys(assetClassList);

	keys.forEach((acName) => {
		const ac: AssetClass = assetClassList[acName];
		const result = validateGroupAllocation(ac, engine);
		if (result) {
			errors.push(result);
		}
	});

	console.log('AA validation results: ', errors);

	return errors;
}

/**
 * Validate that the group's allocation matches the sum of the children classes.
 * @param {AssetClass} assetClass
 */
function validateGroupAllocation(assetClass: AssetClass, engine: AssetAllocationEngine) {
	const children = engine.childrenIndex.get(assetClass.fullname) || [];
	if (children.length === 0) return;

	// sum the children's allocation.
	let sum = 0.0;
	for (let i = 0; i < children.length; i++) {
		//sum += parseFloat(children[i].allocation)
		sum += children[i].allocation;
	}

	//let equal = parseFloat(assetClass.allocation) === sum
	const equal = assetClass.allocation === sum;

	if (!equal) {
		return "- '" + assetClass.fullname + "' does not match the sum of child classes!\n";
	}
}
