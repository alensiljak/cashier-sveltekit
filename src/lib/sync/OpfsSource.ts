/*
	Local (OPFS) implementation of SyncSource — this device's side of a
	beancount peer sync (src/routes/sync/beancount/+page.svelte). See
	doc/projects/2026-07-02_beancount-peer-sync.md.
*/
import {
	listFileTree,
	readFile as opfsReadFile,
	saveFile as opfsSaveFile,
	deleteFile as opfsDeleteFile
} from '$lib/utils/opfslib';
import { parseSpecs, matchesAny } from '$lib/utils/fsScan';
import { settings, SettingKeys } from '$lib/settings';
import { normalizeEol, type SyncEntry, type SyncSource } from './SyncSource';

const DEFAULT_FILE_SPEC = '*.bean, *.toml';
const CACHE_DIR_PREFIX = '.cashier/';
// Device-local pending-transaction staging file — never part of the synced book (see project doc).
const STAGING_FILE = 'cashier.bean';

/** This device's OPFS-backed copy of the ledger book, as a SyncSource. */
export class OpfsSource implements SyncSource {
	/** Lists local ledger files (glob-filtered, files only) for peer sync comparison. */
	async listTree(): Promise<SyncEntry[]> {
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

	async readFile(path: string): Promise<string | undefined> {
		return await opfsReadFile(path);
	}

	async writeFile(path: string, content: string): Promise<void> {
		await opfsSaveFile(path, content);
	}

	async deleteFile(path: string): Promise<void> {
		await opfsDeleteFile(path);
	}

	/**
	 * SHA-256 digest (hex) of the file's content, computed on this device.
	 * Hashes EOL-normalized content — Android/desktop editors disagree on
	 * line endings and trailing newlines, and a peer's byte-identical file
	 * must still verify as a match despite that (see `normalizeEol`).
	 */
	async hashFile(path: string): Promise<string | undefined> {
		const content = await opfsReadFile(path);
		if (content === undefined) return undefined;

		const digest = await crypto.subtle.digest(
			'SHA-256',
			new TextEncoder().encode(normalizeEol(content))
		);
		return Array.from(new Uint8Array(digest))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}
}
