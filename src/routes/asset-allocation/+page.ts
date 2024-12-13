import { AssetAllocationEngine } from '$lib/AssetAllocation'
import type { AssetClass } from '$lib/AssetClass'
import { AssetAllocationFilename } from '$lib/constants.js'
import * as OpfsLib from '$lib/utils/opfslib.js'

export async function load() {
    try {
        const assetClasses: AssetClass[] = await loadData()
        return { assetClasses }
    } catch (error) {
        console.error(error)
    }
}

async function loadData() {
    // check state for caches AA.
    // else
    return await loadAaFromFile()

}

async function loadAaFromFile() {
    const definition = await OpfsLib.readFile(AssetAllocationFilename)
    if(!definition) {
        throw new Error('Could not load AA definition!')
    }

    const aa = new AssetAllocationEngine()
    await aa.loadFullAssetAllocation(definition)

    return aa.assetClasses
}