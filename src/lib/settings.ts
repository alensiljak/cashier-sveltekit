/*
    Various configuration-related things
*/
import db from '$lib/data/db'
import { Setting } from '$lib/data/model'

/**
 * Contains all the values required for the selection mode to function.
 * When an object of this type exists in the state store, we are in selection mode.
 */
export class SelectionModeMetadata {
  // The selection requestor. Can be used to explicitly name the origin and
  // avoid confusion in unexpected navigation routes.
  origin = ''

  postingIndex?: number

  // The type of item being selected. Useful on return to the original entity.
  selectionType?: string

  // The id of the selected item.
  selectedId: unknown
}

export const Constants = {
  CacheName: 'cashier',
  ForecastDays: 7
}

export const SettingKeys = {
  assetAllocationDefinition: 'aa.definition',
  backupServerUrl: 'backupServerUrl',  // Server for online backup (pCloud).
  currency: 'currency',
  favouriteAccounts: 'favouriteAccounts',
  forecastAccounts: 'forecast.accounts',
  forecastDays: 'forecast.days',
  dbInitialized: 'dbInitialized', // Marks that the db has been initialized
  pCloudToken: 'pCloudToken',
  syncServerUrl: 'syncServerUrl',
  ptaSystem: 'ptaSystem', // ledger or beancount
  // path to the prices repository for CashierSync.
  pricesRepositoryPath: 'pricesRepositoryPath',
  // path to the book repository for CashierSync.
  repositoryPath: 'repositoryPath',
  rootInvestmentAccount: 'aa.rootAccount',
  rememberLastTransaction: 'rememberLastTransaction',
  writeableJournalFilePath: 'writeableJournalFilePath',
  // synchronization choices
  syncAccounts: 'syncAccounts',
  syncAaValues: 'syncAaValues',
  syncPayees: 'syncPayees',
  // Home cards
  visibleCards: 'homeCardNames'
}

export const CardNames = {
  FavouritesCard: 'FavouritesCard',
  ForecastCard: 'ForecastCard',
  JournalCard: 'JournalCard',
  ScheduledXactCard: 'ScheduledXactCard',
  SyncCard: 'SyncCard'
}

class Settings {
  /**
   *
   * @param {any} key
   * @returns Promise with the Setting object
   */
  async get<T>(key: unknown): Promise<T> {
    const setting = await db.settings.get(key)

    if (!setting) return null

    let value = null
    try {
      value = JSON.parse(setting.value)
    } catch {
      value = setting.value
    }

    return value
  }

  async getAll() {
    return db.settings.toArray()
  }

  async set(key: string, value: unknown) {
    const jsonValue = JSON.stringify(value)
    const setting = new Setting(key, jsonValue)

    await db.settings.put(setting)
  }
}

const settings = new Settings()
export { settings }
