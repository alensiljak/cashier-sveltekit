import ky from 'ky'
import { settings, SettingKeys } from '../settings'

/**
 * Used to communicate with Ledger server.
 */
export class SyncApiClient {
  serverUrl: string

  constructor() {
    this.serverUrl = ''
  }

  async init() {
    // Server base url
    this.serverUrl = await settings.get(SettingKeys.syncServerUrl)
  }

  /**
   * Perform a ledger-cli query
   * @param {String} query Ledger command. i.e. "balance assets -b 2022-08-01"
   */
  async query(query: string): Promise<Array<any>> {
    const url = new URL(`${this.serverUrl}?query=${query}`)
    //var options = null
    const response = await ky(url) //, options)

    if (!response.ok) {
      throw new Error('Error querying the Cashier server!', response.error)
    }

    const result: Array<any> = await response.json()
    return result
  }
}
