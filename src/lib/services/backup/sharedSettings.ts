/**
 * The shared settings as they travel between devices (S3, WebDAV, Peer Sync). Every channel,
 * with its comparison, preview and merge views, uses these: no secret is sent or shown, and
 * nothing is imported that has not been checked.
 */
import { settings } from '#lib/settings';
import { replaceSettings } from './apply';
import type { StoredSetting } from './model';
import { checkSettingsList } from './readers/common';
import { stripSecrets } from './secrets';

const byKey = (list: StoredSetting[]) => list.sort((a, b) => a.key.localeCompare(b.key));

/** Parses a list of settings and checks every entry. An empty list passes. */
function parseSettingsList(content: string): StoredSetting[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error('The settings data is not valid JSON');
	}
	return checkSettingsList(parsed);
}

/** The shared settings as JSON, without credentials. Sorted, so equal settings give equal text. */
export async function exportSettingsJson(): Promise<string> {
	const stored = (await settings.getAllWithSecrets()) as StoredSetting[];
	return JSON.stringify(byKey(stripSecrets(stored, 'settings')));
}

/** Whether a list from `exportSettingsJson` holds nothing. Such a list is not uploaded. */
export const isEmptySettingsJson = (content: string): boolean =>
	parseSettingsList(content).length === 0;

/**
 * A list of settings, from here or from elsewhere, as it is compared and shown: indented, sorted
 * and without credentials. What an older version sent may still hold them.
 */
export function readableSettingsJson(content: string): string {
	return JSON.stringify(byKey(stripSecrets(parseSettingsList(content), 'settings')), null, 2);
}

/**
 * Replaces the shared settings with a list from another device. The whole list is checked before
 * anything changes. Credentials in it are ignored, and this device keeps its own for the same
 * server.
 */
export async function importSettingsJson(content: string) {
	const list = parseSettingsList(content);
	if (list.length === 0) throw new Error('The settings list is empty, so nothing was changed');
	await replaceSettings(stripSecrets(list, 'settings'));
}
