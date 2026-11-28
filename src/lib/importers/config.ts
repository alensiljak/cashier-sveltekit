import { settings } from '#lib/settings';

/**
 * Importer configs live in the user `settings` table, so they are included in
 * backups and in the settings sync between peers. An importer is "configured"
 * when its key exists; resetting deletes the key.
 *
 * So a config must never hold a secret (token, password, private key): it would be backed up and
 * synced as plain text, and the types cannot detect that. Secrets are device settings with their
 * own key and backup rule. tests/unit/importerConfigSecrets.test.ts lists every config field.
 */
const key = (importerId: string) => `importer.${importerId}` as const;

export function loadImporterConfig<T>(importerId: string): Promise<T | null> {
	return settings.get<T>(key(importerId));
}

export function saveImporterConfig(importerId: string, config: unknown): Promise<void> {
	return settings.set(key(importerId), config);
}

export function resetImporterConfig(importerId: string): Promise<void> {
	return settings.delete(key(importerId));
}
