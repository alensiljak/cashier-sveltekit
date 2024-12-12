import { AssetAllocationFilename } from '$lib/constants.js'
import * as OpfsLib from '$lib/utils/opfslib.js'

export async function load({ params }) {
    // console.debug(params)

    try {
        await loadData()
    } catch (error) {
        console.error(error)
    }
}

async function loadData() {
    // check state for caches AA.
    // else
    await loadAaFromFile()

}

async function loadAaFromFile() {
    const alloc = await OpfsLib.readFile(AssetAllocationFilename)

    console.debug('allocation:', alloc)
}