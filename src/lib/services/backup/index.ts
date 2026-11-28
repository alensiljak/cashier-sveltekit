/*
    Backup Service
	Backup and restore of this device's data using a JSON file. See doc/backup.md.

	The file is versioned (`version`; version 1 files have none). Each format version has its own
	reader (readers/), which validates the file and converts it into `BackupData` (model.ts).
	Writing (write.ts, latest version only) and restoring (apply.ts) exist once.
*/
import { applyBackup, type RestoreOptions, type RestoreResult } from './apply';
import { ALL_SECTIONS, type BackupData, type BackupSection } from './model';
import { readV1 } from './readers/v1';
import { readV2 } from './readers/v2';
import { BACKUP_VERSION } from './write';

export { importSettingsJson, type RestoreOptions, type RestoreResult } from './apply';
export { ALL_SECTIONS, type BackupSection } from './model';
export {
	BACKUP_VERSION,
	createBackup,
	createBackupFile,
	exportSettingsJson,
	getBackupFilename,
	type BackupOptions
} from './write';

/** The readers of the versions the file states. Version 1 files state none. */
const READERS: Record<number, (file: Record<string, unknown>) => BackupData> = {
	2: readV2
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
	if (!ALL_SECTIONS.some((s) => data[s] !== undefined)) {
		throw new Error('The backup file holds nothing to restore');
	}
	return data;
}

export interface BackupInfo {
	version: number;
	/** Sections the file holds. */
	sections: BackupSection[];
	hasSecrets: boolean;
	counts: { settings: number; scx: number; peers: number };
}

/** What a backup file holds, for the restore dialog. Throws for a file that can't be restored. */
export function inspectBackup(content: string): BackupInfo {
	const data = readBackup(content);
	return {
		version: data.version,
		sections: ALL_SECTIONS.filter((s) => data[s] !== undefined),
		hasSecrets: data.openSecrets !== undefined,
		counts: {
			settings: data.settings?.length ?? 0,
			scx: data.scx?.length ?? 0,
			peers: data.peers?.peers.length ?? 0
		}
	};
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
