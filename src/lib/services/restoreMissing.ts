/**
 * Fields a backup restore left empty because they are secrets (see backupSecrets.ts). The pages
 * that hold them mark them as required until they are filled in.
 *
 * Field ids are `<setting label>.<field>`: 'webdav.password', 's3.secretAccessKey', ...
 */
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';

export async function getRestoreMissing(): Promise<string[]> {
	const saved = await deviceSettings.get<string[]>(DeviceSettingKeys.restoreMissing);
	return Array.isArray(saved) ? saved : [];
}

export async function setRestoreMissing(ids: string[]): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.restoreMissing, ids);
}

/** Removes the fields that now have a value. Fields not named stay in the list. */
export async function clearRestoreMissing(...ids: string[]): Promise<void> {
	const current = await getRestoreMissing();
	const next = current.filter((id) => !ids.includes(id));
	if (next.length !== current.length) await setRestoreMissing(next);
}
