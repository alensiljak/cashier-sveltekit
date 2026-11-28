/*
    Backup Service
	Backup and restore of this device's data using a JSON file. See doc/backup.md.

	The file is versioned (`version`; version 1 files have none). Each format version has its own
	reader (readers/), which validates the file and converts it into `BackupData` (model.ts).
	Writing (write.ts, latest version only) and restoring (apply.ts) exist once.
*/
import {
	applyBackup,
	previewPeers,
	previewStores,
	type RestoreOptions,
	type RestoreResult,
	type StoreOutcomes
} from './apply';
import { sectionsOf, type BackupData, type BackupSection } from './model';
import { readV1 } from './readers/v1';
import { readV2 } from './readers/v2';
import { readV3 } from './readers/v3';
import { BACKUP_VERSION } from './write';

export type {
	RestoreOptions,
	RestoreResult,
	StoreOutcome,
	StoreOutcomes,
	StoreSection
} from './apply';
export { ALL_SECTIONS, type BackupSection } from './model';
export {
	exportSettingsJson,
	importSettingsJson,
	isEmptySettingsJson,
	readableSettingsJson
} from './sharedSettings';
export {
	BACKUP_VERSION,
	compressBackup,
	createBackup,
	createBackupFile,
	getBackupFilename,
	type BackupOptions
} from './write';

export interface BackupContent {
	/** The file's JSON, which the functions below work with. */
	content: string;
	compressed: boolean;
}

/** The text of a backup file, gzipped or plain; which it is, is seen from its first bytes. */
export async function decodeBackup(bytes: Uint8Array<ArrayBuffer>): Promise<BackupContent> {
	const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b;
	if (!compressed) return { content: new TextDecoder().decode(bytes), compressed };
	try {
		const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'));
		return { content: await new Response(stream).text(), compressed };
	} catch {
		throw new Error('The backup file is damaged: it cannot be decompressed');
	}
}

/** The readers of the versions the file states. Version 1 files state none. */
const READERS: Record<number, (file: Record<string, unknown>) => BackupData> = {
	2: readV2,
	3: readV3
};

/** Parses and checks the backup file, so nothing is deleted for a file that can't be restored. */
function readBackup(content: string): BackupData {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error('The backup file is not valid JSON');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Not a Cashier backup file');
	}
	const file = parsed as Record<string, unknown>;

	const { version } = file;
	if (version === undefined) return readV1(file);
	if (typeof version === 'number' && version > BACKUP_VERSION) {
		throw new Error(
			`This backup was made by a newer version of Cashier (backup format ${version}). Update the app to restore it.`
		);
	}
	const read = typeof version === 'number' ? READERS[version] : undefined;
	if (!read) throw new Error('Not a Cashier backup file: unknown version');

	const data = read(file);
	if (sectionsOf(data).length === 0) {
		throw new Error('The backup file holds nothing to restore');
	}
	return data;
}

export interface BackupInfo {
	version: number;
	/** Sections the file holds. */
	sections: BackupSection[];
	hasSecrets: boolean;
	/** Which credentials the file says it has. Format 2 does not say: the list is empty. */
	credentials: string[];
	/** The scheduled transactions are a list without history, as in older files. */
	scxIsList: boolean;
	counts: { settings: number; peers: number };
}

/** What a backup file holds, for the restore dialog. Throws for a file that can't be restored. */
export function inspectBackup(content: string): BackupInfo {
	const data = readBackup(content);
	return {
		version: data.version,
		sections: sectionsOf(data),
		hasSecrets: data.openSecrets !== undefined,
		credentials: data.openSecrets ? (data.credentials ?? []) : [],
		scxIsList: !!data.scx && 'list' in data.scx,
		counts: {
			settings: data.settings?.length ?? 0,
			peers: data.peers?.peers.length ?? 0
		}
	};
}

/** What restoring a backup file would do to each transaction store it holds. */
export async function previewRestore(content: string): Promise<StoreOutcomes> {
	return previewStores(readBackup(content));
}

/** How many trusted devices restoring a backup file would add. */
export async function previewRestoredPeers(content: string): Promise<number> {
	return previewPeers(readBackup(content));
}

/**
 * Restores a backup file (see `applyBackup`). The file is validated before anything is written,
 * so an invalid file keeps existing data.
 * @param content JSON contents of the backup file
 */
export async function restoreBackup(
	content: string,
	options: RestoreOptions = {}
): Promise<RestoreResult> {
	return applyBackup(readBackup(content), options);
}
