/**
 * Scalable Capital importer configuration. JSON-serializable, stored in the
 * user settings under `importer.scalable`, so it syncs between devices and is
 * part of backups.
 *
 * The MCP access token is deliberately NOT part of this config: it is a
 * credential and lives in device-only settings (see token.ts), so it is never
 * exported or synced.
 *
 * Shared and exported as plain text: never add a secret here (see importers/config.ts).
 */
export interface ScalableConfig {
	/** Broker portfolio to read. Needed only when the account has several. */
	portfolioId?: string;
}

export const scalableDefaultConfig: ScalableConfig = {};
