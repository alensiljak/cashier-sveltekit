import { OpfsXactStore } from './opfsXactStore';
import type { XactStore } from './xactStore';
import { DeviceSettingKeys, deviceSettings } from '$lib/settings';

/**
 * The active working-set store, chosen by the `xactStore` device setting
 * (OPFS when missing or unrecognised). Every consumer — LedgerService, the
 * editor, the journal — gets it through `getXactStore()`, which resolves the
 * setting on first use and hands out the same store afterwards. So the result
 * is correct whichever caller comes first; nothing has to initialise it in
 * a particular order. A changed setting takes effect on the next load.
 */
let active: Promise<XactStore> | undefined;

export function getXactStore(): Promise<XactStore> {
	active ??= resolveStore();
	return active;
}

/** Replace the active store (e.g. in tests). */
export function setXactStore(store: XactStore): void {
	active = Promise.resolve(store);
}

async function resolveStore(): Promise<XactStore> {
	const kind = await deviceSettings.get<string>(DeviceSettingKeys.xactStore);
	if (kind === 'crdt') {
		// Loaded on demand so Yjs stays out of the way for OPFS users.
		const { CrdtXactStore } = await import('./crdtXactStore');
		return new CrdtXactStore();
	}
	return new OpfsXactStore();
}
