import { AssetAllocationEngine } from '$lib/AssetAllocation'
import type { AssetClass } from '$lib/AssetClass'
import { AssetAllocationFilename } from '$lib/constants.js'
import { AssetAllocationStore } from '$lib/data/mainStore'
import * as OpfsLib from '$lib/utils/opfslib.js'
import { get } from 'svelte/store'

export async function load() {
    try {
        // check state for cached AA.
        let assetClasses: AssetClass[] | undefined = get(AssetAllocationStore)
        if (!assetClasses || assetClasses.length === 0) {
            assetClasses = await loadAaFromFile()

            // save into store.
            AssetAllocationStore.set(assetClasses)
        }

        return { assetClasses }
    } catch (error) {
        console.error(error)
    }
}

async function loadAaFromFile() {
    const definition = await OpfsLib.readFile(AssetAllocationFilename)
    if (!definition) {
        throw new Error('Could not load AA definition!')
    }

    const aa = new AssetAllocationEngine()
    await aa.loadFullAssetAllocation(definition)

    return aa.assetClasses
}