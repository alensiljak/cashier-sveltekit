import { listFileTree } from '$lib/utils/opfslib';
import { deviceSettings, DeviceSettingKeys } from '$lib/settings';

type MetaMap = Record<string, string>;

function metaEntry(size: number, lastModified: number): string {
	return `${size}|${lastModified}`;
}

async function runCheck(): Promise<boolean> {
	const stored = await deviceSettings.get<MetaMap>(DeviceSettingKeys.ledgerMetaSnapshot);
	if (!stored) return true;

	const tree = await listFileTree();
	const beanFiles = tree.filter((e) => e.kind === 'file' && e.name.endsWith('.bean'));

	if (beanFiles.length !== Object.keys(stored).length) return true;

	for (const entry of beanFiles) {
		const storedVal = stored[entry.path];
		if (!storedVal) return true;
		if (metaEntry(entry.size!, entry.lastModified!) !== storedVal) return true;
	}

	return false;
}

/**
 * Checks whether any .bean file in OPFS differs from the stored metadata snapshot.
 * Run on demand ("Check files" menu item). Not run at startup: the ledger load already
 * compares source file timestamps to the binary cache, so this only matters for changes
 * made while the app is open.
 */
export function recheckOpfsStale(): Promise<boolean> {
	return runCheck();
}

/**
 * Saves the current .bean file metadata to settings as the new snapshot baseline.
 * Call this after a successful reload + re-serialize.
 */
export async function saveOpfsMetaSnapshot(): Promise<void> {
	const tree = await listFileTree();
	const beanFiles = tree.filter((e) => e.kind === 'file' && e.name.endsWith('.bean'));

	const map: MetaMap = {};
	for (const entry of beanFiles) {
		map[entry.path] = metaEntry(entry.size!, entry.lastModified!);
	}

	await deviceSettings.set(DeviceSettingKeys.ledgerMetaSnapshot, map);
}
