import { listFileTree } from '$lib/utils/opfslib';
import { settings, SettingKeys } from '$lib/settings';

type MetaMap = Record<string, string>;

// Cached per session — module state persists across SPA navigations.
let sessionCheck: Promise<boolean> | null = null;

function metaEntry(size: number, lastModified: number): string {
	return `${size}|${lastModified}`;
}

async function runCheck(): Promise<boolean> {
	const stored = await settings.get<MetaMap>(SettingKeys.ledgerMetaSnapshot);
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
 * Runs at most once per app session; subsequent calls return the cached result.
 */
export function checkOpfsStale(): Promise<boolean> {
	if (!sessionCheck) {
		sessionCheck = runCheck();
	}
	return sessionCheck;
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

	await settings.set(SettingKeys.ledgerMetaSnapshot, map);
	sessionCheck = Promise.resolve(false);
}
