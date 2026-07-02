/*
	Local (OPFS) side of the peer file-listing protocol. Lists the ledger
	files this device holds, for display next to a peer's remote list on
	the beancount sync page (`src/routes/sync/beancount/+page.svelte`).

	Read-only for now — write-back (pull) and hashing land with the sync
	engine (see doc/projects/2026-07-02_beancount-peer-sync.md).
*/
import { listFileTree } from '$lib/utils/opfslib';
import { parseSpecs, matchesAny } from '$lib/utils/fsScan';
import { settings, SettingKeys } from '$lib/settings';

/** Metadata-only file record shared by the local and remote (peer) listings. */
// Index signature required so the type satisfies trystero's DataPayload's { [key: string]: JsonValue } branch
export interface SyncEntry {
	path: string;
	size: number;
	lastModified: number;
	[key: string]: string | number;
}

const DEFAULT_FILE_SPEC = '*.bean, *.toml';
const CACHE_DIR_PREFIX = '.cashier/';
// Device-local pending-transaction staging file — never part of the synced book (see project doc).
const STAGING_FILE = 'cashier.bean';

/** Lists local ledger files (glob-filtered, files only) for peer sync comparison. */
export async function listLocalTree(): Promise<SyncEntry[]> {
	const spec = (await settings.get<string>(SettingKeys.importBookFileSpec)) ?? DEFAULT_FILE_SPEC;
	const patterns = parseSpecs(spec);
	const entries = await listFileTree();

	return entries
		.filter(
			(e) =>
				e.kind === 'file' &&
				matchesAny(e.name, patterns) &&
				e.path !== STAGING_FILE &&
				!e.path.startsWith(CACHE_DIR_PREFIX)
		)
		.map((e) => ({ path: e.path, size: e.size ?? 0, lastModified: e.lastModified ?? 0 }));
}
