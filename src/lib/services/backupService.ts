/*
    Backup Service
	Backup and restore custom data using a JSON file.
*/

import { ISODATEFORMAT, LONGTIMEFORMAT } from '#lib/constants';
import db from '#lib/data/db';
import { listScx, replaceAllScx } from '#lib/services/scxService';
import type { ScheduledTransaction } from '#lib/data/model';
import { SettingKeys, settings } from '#lib/settings';
import moment from 'moment';

interface StoredSetting {
	key: string;
	value: string;
}

interface Backup {
	settings: Array<StoredSetting>;
	scx: Array<ScheduledTransaction>;
}

type WebDavCredentials = { url?: string; username?: string; password?: string };

function parseWebDav(setting: StoredSetting | undefined): WebDavCredentials | undefined {
	if (!setting) return undefined;
	try {
		const parsed = JSON.parse(setting.value);
		return parsed && typeof parsed === 'object' ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Blanks the WebDAV password, so the backup file (which gets downloaded, shared
 * and stored elsewhere) never carries credentials.
 */
function withoutPassword(all: StoredSetting[]): StoredSetting[] {
	return all.map((setting) => {
		if (setting.key !== SettingKeys.webdavSettings) return setting;
		const webdav = parseWebDav(setting);
		if (!webdav) return setting;
		return { ...setting, value: JSON.stringify({ ...webdav, password: '' }) };
	});
}

/**
 * The backup has no WebDAV password, so restoring must not erase the one already on
 * this device: keep it when the backup points at the same server and user.
 */
function keepExistingPassword(
	restored: StoredSetting[],
	existing: StoredSetting | undefined
): StoredSetting[] {
	const current = parseWebDav(existing);
	if (!current?.password) return restored;

	return restored.map((setting) => {
		if (setting.key !== SettingKeys.webdavSettings) return setting;
		const webdav = parseWebDav(setting);
		if (!webdav || webdav.password) return setting;
		if (webdav.url !== current.url || webdav.username !== current.username) return setting;
		return { ...setting, value: JSON.stringify({ ...webdav, password: current.password }) };
	});
}

export function getBackupFilename(): string {
	// filename
	const now = moment();
	const date = now.format(ISODATEFORMAT);
	const time = now.format(LONGTIMEFORMAT);
	const filename = `cashier-backup_${date}_${time}.json`;

	return filename;
}

/**
 * Generates backup file and sends it via download.
 */
export async function createBackupFile(filename: string) {
	const output: string = await createBackup();

	downloadTextFile(output, filename);
}

/**
 * Create backup content as text.
 * @returns Text containing the backup content.
 */
export async function createBackup() {
	// assemble the backup content:
	// settings
	const allSettings = withoutPassword(await settings.getAll());
	// scheduled transactions
	const scx: ScheduledTransaction[] = await listScx();

	const backup: Backup = {
		settings: allSettings,
		scx: scx
	};

	const output = JSON.stringify(backup);
	return output;
}

function downloadTextFile(content: string, fileName: string) {
	const blob = new Blob([content], { type: 'text/plain' });
	const url = URL.createObjectURL(blob);

	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;

	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	// Clean up
	setTimeout(() => {
		URL.revokeObjectURL(url);
	}, 1500);
}

/** Parses and checks the backup file, so nothing is deleted for a file that can't be restored. */
function parseBackup(content: string): Backup {
	let backup: Partial<Backup> | null;
	try {
		backup = JSON.parse(content);
	} catch {
		throw new Error('The backup file is not valid JSON');
	}
	if (!backup || !Array.isArray(backup.settings) || !Array.isArray(backup.scx)) {
		throw new Error('Not a Cashier backup file: settings and scheduled transactions are missing');
	}
	return backup as Backup;
}

/**
 * Restores the backup, deleting any existing data.
 * The file is validated before anything is written, so an invalid file keeps existing data.
 * @param content JSON contents of the backup file
 */
export async function restoreBackup(content: string) {
	const backup = parseBackup(content);

	await replaceSettings(backup.settings);
	await replaceAllScx(backup.scx);
}

async function replaceSettings(restored: StoredSetting[]) {
	await db.transaction('rw', db.settings, async () => {
		const merged = keepExistingPassword(
			restored,
			await db.settings.get(SettingKeys.webdavSettings)
		);
		await db.settings.clear();
		await db.settings.bulkAdd(merged);
	});
}

/** The shared settings as JSON, without credentials. Sorted, so equal settings give equal text. */
export async function exportSettingsJson(): Promise<string> {
	const all = withoutPassword(await settings.getAll());
	return JSON.stringify(all.sort((a, b) => a.key.localeCompare(b.key)));
}

/** Replaces the shared settings with those from `exportSettingsJson`. Validated before any write. */
export async function importSettingsJson(content: string) {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error('The settings data is not valid JSON');
	}
	if (!Array.isArray(parsed)) throw new Error('The settings data is not a list of settings');
	await replaceSettings(parsed as StoredSetting[]);
}
