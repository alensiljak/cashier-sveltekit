/*
    Backup Service
*/

import { ISODATEFORMAT, LONGTIMEFORMAT } from "$lib/constants";
import db from "$lib/data/db";
import type { ScheduledTransaction, Xact } from "$lib/data/model";
import { settings } from "$lib/settings";
import moment from "moment";

interface Backup {
    settings: Array<string>,
    journal: Array<Xact>,
    scx: Array<ScheduledTransaction>
}

export function getBackupFilename(): string {
    // filename
    const now = moment();
    const date = now.format(ISODATEFORMAT);
    const time = now.format(LONGTIMEFORMAT);
    const filename = `cashier-backup_${date}_${time}.json`;

    return filename
}

/**
 * Generates backup file and sends it via download.
 */
export async function createBackup(filename: string) {
    // assemble the backup content
    const allSettings = await settings.getAll()
    const journal = await db.xacts.toArray()
    const scx: ScheduledTransaction[] = await db.scheduled.toArray()

    const backup: Backup = {
        settings: allSettings,
        journal: journal,
        scx: scx
    };

    const output = JSON.stringify(backup);

    downloadTextFile(output, filename);
}

function downloadTextFile(text: string, fileName: string) {
    const blob = new Blob([text], { type: 'text/plain' });
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

export async function restoreBackup(content: string) {
    const backup: Backup = JSON.parse(content)

    // backup.settings
    // backup.journal
    // backup.scx

    console.log(backup.settings.length)
}