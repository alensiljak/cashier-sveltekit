/**
 * Enable Banking importer configuration. JSON-serializable, stored in the
 * user settings under `importer.enablebanking`, so it syncs between devices
 * and is part of backups.
 *
 * Credentials (application ID + private key) and sessions are deliberately
 * NOT part of this config: they live in device-only settings (auth.ts,
 * sessions.ts) and are never synced; a backup holds them only encrypted.
 *
 * Shared and exported as plain text: never add a secret here (see importers/config.ts).
 */
export interface EnableBankingConfig {
	/**
	 * The account last selected on the operations page: its identification_hash
	 * (stable across sessions and devices), or the session's uid without one.
	 */
	selectedAccount?: string;
	/** How many days of transactions to load by default. Default 90. */
	daysBack?: number;
	/** PSU type used when connecting a bank ('personal' or 'business'). */
	psuType?: 'personal' | 'business';
}

export const enableBankingDefaultConfig: EnableBankingConfig = {
	daysBack: 90,
	psuType: 'personal'
};
