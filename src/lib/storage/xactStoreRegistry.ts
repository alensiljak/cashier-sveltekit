import { OpfsXactStore } from './opfsXactStore';
import type { XactStore } from './xactStore';
import { DeviceSettingKeys, deviceSettings } from '$lib/settings';
import { CASHIER_XACT_FILE } from '$lib/constants';
import { fileExists } from '$lib/utils/opfslib';

/**
 * The active working-set store, chosen by the `xactStore` device setting
 * (when missing: CRDT, or OPFS if a legacy `cashier.bean` exists; when
 * unrecognised: OPFS). Every consumer — LedgerService, the
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

/**
 * The kind to use when the setting was never saved: CRDT for new installs, but
 * OPFS when a legacy `cashier.bean` is already there, so existing devices keep
 * their working set. The result is saved, so the choice stays stable.
 */
async function defaultKind(): Promise<'opfs' | 'crdt'> {
	const kind = (await fileExists(CASHIER_XACT_FILE)) ? 'opfs' : 'crdt';
	await deviceSettings.set(DeviceSettingKeys.xactStore, kind);
	return kind;
}

async function resolveStore(): Promise<XactStore> {
	const kind =
		(await deviceSettings.get<string>(DeviceSettingKeys.xactStore)) ?? (await defaultKind());
	if (kind === 'crdt') {
		// Loaded on demand so Yjs stays out of the way for OPFS users.
		const { CrdtXactStore } = await import('./crdtXactStore');
		return new CrdtXactStore();
	}
	return new OpfsXactStore();
}
