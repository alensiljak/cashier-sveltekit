/*
    Cloud backup
*/

import moment from "moment";
import appService from "./appService";
import { BackupType } from "$lib/enums";
import { ISODATEFORMAT, LONGTIMEFORMAT } from "$lib/constants";
import { createClient, type FileStat } from 'webdav'

export class CloudBackupService {
    _serverUrl: string
    _client
    // Used to avoid sending too many request.
    _resourceCache?: FileStat[]

    constructor(serverUrl: string) {
        this._serverUrl = serverUrl
        this._client = createClient(serverUrl)
    }

    async backupScheduledXacts() {
        // get the JSON data for export
        const output = await appService.getScheduledXactsForExport()
        if (!output) {
            throw new Error('Error retrieving and serializing Scheduled Transactions!')
        }

        // get filename
        const filename = this.getFilenameForNewBackup(BackupType.SCHEDULEDXACTS)

        // upload
        //const url = this.getUrl(`/${filename}`)
        const path = `/${filename}`
        //const 
        const result = await this._client.putFileContents(path, output)
        return result
    }

    clearCache() {
        this._resourceCache = undefined
    }

    /**
     * Retrieves the number of backups for the given backup type.
     * @returns 
     */
    async getRemoteBackupCount(backupType: string): Promise<number> {
        const files = await this.getFileListing()
        const filenames = files.map(f => f.basename)

        // filter only the backups for Scheduled Xacts
        const result = filenames
            .filter(f => f.startsWith(backupType))
            .length
        return result
    }

    async getLatestFilename(): Promise<string> {
        const files = await this.getFileListing()
        const filenames = files.map(f => f.basename)

        // get only the scheduled xact backups
        const result = filenames
            .filter(f => f.startsWith(BackupType.SCHEDULEDXACTS))
            .sort((a, b) => b.localeCompare(a))
        [0];
        return result
    }

    // private

    async getFileListing(): Promise<FileStat[]> {
        // Fetch the file listing only if the cache is empty.
        if (!this._resourceCache) {
            //const url = this.getUrl('/')
            const response = await this._client.getDirectoryContents('/')

            // cache the listing
            this._resourceCache = response as FileStat[]
        }

        return this._resourceCache
    }

    getFilenameForNewBackup(backupType: string) {
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

    getUrl(path: string) {
        return `${this._serverUrl}/${path}`
    }

}
