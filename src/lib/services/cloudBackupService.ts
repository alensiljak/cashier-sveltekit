/*
    Cloud backup
*/

export function backupScheduledXacts() {

}

export function getRemoteBackupCount() {
    let files = getFileListing()

    // filter only the backups for Scheduled Xacts
    let result = files.filter();
    return result
}

export function getLatestFilename(): string {

}

// private

function getFileListing(): string[] {
    // Fetch the file listing only if the cache is empty.
    let url = getUrl('/')
}

function getUrl(url: string) {

}