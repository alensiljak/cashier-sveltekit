/*
    Backup Service
*/

import { ISODATEFORMAT, LONGTIMEFORMAT } from '$lib/constants';
import db from '$lib/data/db';
import type { ScheduledTransaction, Xact } from '$lib/data/model';
import { settings } from '$lib/settings';
import moment from 'moment';

interface Backup {
	settings: Array<string>;
	journal: Array<Xact>;
	scx: Array<ScheduledTransaction>;
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
	const output: string = await createBackup()

	downloadTextFile(output, filename);
}

/**
 * Create backup content as text.
 * @returns Text containing the backup content.
 */
export async function createBackup() {
	// assemble the backup content
	const allSettings = await settings.getAll();
	const journal = await db.xacts.toArray();
	const scx: ScheduledTransaction[] = await db.scheduled.toArray();

	const backup: Backup = {
		settings: allSettings,
		journal: journal,
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

/**
 * Restores the backup, deleting any existing data.
 * @param content JSON contents of the backup file
 */
export async function restoreBackup(content: string) {
	const backup: Backup = JSON.parse(content);

	// backup.settings
	await db.settings.clear();
	await db.settings.bulkAdd(backup.settings);

	// backup.journal
	await db.xacts.clear();
	await db.xacts.bulkAdd(backup.journal);

	// backup.scx
	await db.scheduled.clear();
	await db.scheduled.bulkAdd(backup.scx);
}
