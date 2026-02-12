import { AssetAllocationEngine } from '$lib/assetAllocation/AssetAllocation';
import type { AssetClass } from '$lib/assetAllocation/AssetClass';
import { AssetAllocationFilename } from '$lib/constants.js';
import { AssetAllocationStore } from '$lib/data/mainStore';
import Notifier from '$lib/utils/notifier';
import * as OpfsLib from '$lib/utils/opfslib.js';
import { get } from 'svelte/store';
import { formatErrorForDisplay, AppError } from '$lib/utils/errors';

const aa = new AssetAllocationEngine();

export async function load() {
	try {
		// check state for cached AA.
		let assetClasses: AssetClass[] | undefined = get(AssetAllocationStore);
		if (!assetClasses || assetClasses.length === 0) {
			await loadAaFromFile();
			assetClasses = aa.assetClasses;

			// save into store.
			AssetAllocationStore.set(assetClasses);
		}

		// Show warnings if any commodities are not mapped
		if (aa.warnings.length > 0) {
			const warningMsg =
				aa.warnings.length === 1
					? aa.warnings[0]
					: `${aa.warnings.length} commodities not mapped to asset classes. Check console for details.`;
			Notifier.warning(warningMsg);
			console.warn('Asset Allocation warnings:', aa.warnings);
		}

		return { aa, assetClasses };
	} catch (error) {
		console.error(error);

		// Use improved error formatting for better user messages
		if (error instanceof AppError) {
			const { title, message, action } = formatErrorForDisplay(error);
			const fullMessage = action ? `${message}\n\n${action}` : message;
			Notifier.error(`${title}: ${fullMessage}`);
		} else {
			Notifier.error(`Could not load Asset Allocation. ${error}`);
		}

		// Return empty data to prevent page crash
		return { aa, assetClasses: [] };
	}
}

async function loadAaFromFile() {
	const definition = await OpfsLib.readFile(AssetAllocationFilename);
	if (!definition) {
		throw new Error('Could not load AA definition!');
	}

	await aa.loadFullAssetAllocation(definition);
}
