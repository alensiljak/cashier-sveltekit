import { AssetAllocationEngine } from '$lib/assetAllocation/AssetAllocation';
import type { AssetClass } from '$lib/assetAllocation/AssetClass';
import { AssetAllocationFilename } from '$lib/constants.js';
import { AssetAllocationStore } from '$lib/data/mainStore';
import Notifier from '$lib/utils/notifier';
import * as OpfsLib from '$lib/utils/opfslib.js';
import { get } from 'svelte/store';

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

		return { aa, assetClasses };
	} catch (error) {
		console.error(error);
		Notifier.error(`Could not load Asset Allocation. ${error}`);
	}
}

async function loadAaFromFile() {
	const definition = await OpfsLib.readFile(AssetAllocationFilename);
	if (!definition) {
		throw new Error('Could not load AA definition!');
	}

	await aa.loadFullAssetAllocation(definition);
}
