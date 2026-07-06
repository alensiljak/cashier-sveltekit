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

/** This device's OPFS-backed copy of the ledger book, as a SyncSource. */
export class OpfsSource implements SyncSource {
	/**
	 * Lists local ledger files (glob-filtered, files only) for peer sync
	 * comparison, hashing each file's content along the way — diff
	 * classification (syncDiff.ts) needs the hash to tell real content
	 * changes from filesystem-mtime noise.
	 */
	async listTree(): Promise<SyncEntry[]> {
		const spec = (await settings.get<string>(SettingKeys.importBookFileSpec)) ?? DEFAULT_FILE_SPEC;
		const patterns = parseSpecs(spec);
		const entries = await listFileTree();

		const files = entries.filter(
			(e) =>
				e.kind === 'file' && matchesAny(e.name, patterns) && !e.path.startsWith(CACHE_DIR_PREFIX)
		);

		return Promise.all(
			files.map(async (e) => {
				const content = (await opfsReadFile(e.path)) ?? '';
				const digest = await crypto.subtle.digest(
					'SHA-256',
					new TextEncoder().encode(normalizeEol(content))
				);
				const hash = Array.from(new Uint8Array(digest))
					.map((b) => b.toString(16).padStart(2, '0'))
					.join('');
				return { path: e.path, size: e.size ?? 0, lastModified: e.lastModified ?? 0, hash };
			})
		);
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
}
