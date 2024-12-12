/*
    Cloud backup
*/

import moment from "moment";
import appService from "./appService";
import { BackupType } from "$lib/enums";
import { ISODATEFORMAT, LONGTIMEFORMAT } from "$lib/constants";

export async function backupScheduledXacts() {
    // get the JSON data for export
    let output = await appService.getScheduledXactsForExport()
    if (!output) {
        throw new Error('Error retrieving and serializing Scheduled Transactions!')
    }

    // get filename
    const filename = getFilenameForNewBackup(BackupType.SCHEDULEDXACTS)
    console.debug(filename)
    // upload
}

export function clearCache() {

}

export function getRemoteBackupCount() {
    const files = getFileListing()

    // filter only the backups for Scheduled Xacts
    const result = files;
    return result
}

export function getLatestFilename(): string {

}

// private

function getFileListing(): string[] {
    // Fetch the file listing only if the cache is empty.
    let url = getUrl('/')
}


function getFilenameForNewBackup(backupType: string) {
    const now = moment()

    // file extension
    let extension;
    switch (backupType) {
        case BackupType.JOURNAL:
            extension = 'ledger'
            break;
        default:
            // case BackupType.SCHEDULEDXACTS:
            extension = 'json'
            break;
    }

    const prefix = backupType.toLowerCase()
    const date = now.format(ISODATEFORMAT)
    const time = now.format(LONGTIMEFORMAT)

    const filename = `${prefix}_${date}_${time}.${extension}`

    return filename
}

function getUrl(url: string) {

}