/**
 * Writes backup files, in the latest format only. What the format holds is described by its
 * reader (readers/v3.ts).
 */
import { ISODATEFORMAT, LONGTIMEFORMAT } from '#lib/constants';
import db from '#lib/data/db';
import { toBase64 } from '#lib/services/s3Crypto';
import { getReadyScxStore } from '#lib/services/scxService';
import { deviceSettings, settings } from '#lib/settings';
import { getXactStore } from '#lib/storage/xactStoreRegistry';
import { getDeviceId } from '#lib/sync/ydocDevices';
import { formatDate } from '#lib/utils/dates';
import {
	ALL_SECTIONS,
	PORTABLE_DEVICE_KEYS,
	type BackupSection,
	type DeviceData,
	type PeersData,
	type StoredSetting
} from './model';
import {
	parseJson,
	sealSecrets,
	secretId,
	specFor,
	splitSecrets,
	type SecretSpec,
	type SecretsBlock
} from './secrets';

export const BACKUP_VERSION = 3;

interface BackupFile {
	version: number;
	settings?: StoredSetting[];
	scx?: string;
	workingSet?: string;
	device?: DeviceData;
	withheld?: string[];
	peers?: PeersData;
	secrets?: SecretsBlock;
}

/**
 * Blanks the secret fields of the settings that have them. Returns the secrets that were taken
 * out, keyed by `secretId`, and the ids of the fields that had a value.
 */
function stripSecrets(
	list: StoredSetting[],
	store: SecretSpec['store'],
	into: { secrets: Record<string, unknown>; withheld: string[] }
): StoredSetting[] {
	return list.map((setting) => {
		const spec = specFor(store, setting.key);
		if (!spec) return setting;
		const value = parseJson(setting.value);
		if (value === undefined) return setting;
		const { plain, secrets, withheld } = splitSecrets(value, spec);
		if (secrets !== undefined) into.secrets[secretId(spec)] = secrets;
		into.withheld.push(...withheld);
		return { ...setting, value: JSON.stringify(plain) };
	});
}

const byKey = (list: StoredSetting[]) => list.sort((a, b) => a.key.localeCompare(b.key));

export function getBackupFilename(): string {
	// filename
	const now = new Date();
	const date = formatDate(now, ISODATEFORMAT);
	const time = formatDate(now, LONGTIMEFORMAT);
	const filename = `cashier-backup_${date}_${time}.json`;

	return filename;
}

export interface BackupOptions {
	/** What goes into the file. All sections when left out. */
	sections?: BackupSection[];
	/** Set to include the credentials, encrypted with this passphrase. Without it, the file has none. */
	secretsPassphrase?: string;
}

/**
 * Generates backup file and sends it via download.
 */
export async function createBackupFile(filename: string, options?: BackupOptions) {
	const output: string = await createBackup(options);

	downloadTextFile(output, filename);
}

/**
 * Create backup content as text.
 *
 * The device's own signing key is never in the file: it is not extractable by design, so a
 * restored device is a new device (see restoredDevice.ts).
 * @returns Text containing the backup content.
 */
export async function createBackup(options: BackupOptions = {}) {
	const sections = new Set(options.sections ?? ALL_SECTIONS);
	const stripped = { secrets: {} as Record<string, unknown>, withheld: [] as string[] };
	const backup: BackupFile = { version: BACKUP_VERSION };

	if (sections.has('settings')) {
		backup.settings = byKey(stripSecrets(await settings.getAll(), 'settings', stripped));
	}
	if (sections.has('scx')) {
		backup.scx = toBase64(await (await getReadyScxStore()).exportState());
	}
	if (sections.has('workingSet')) {
		backup.workingSet = toBase64(await (await getXactStore()).exportState());
	}
	if (sections.has('device')) {
		const all = (await deviceSettings.getAll()) as StoredSetting[];
		const portable = all.filter((s) => PORTABLE_DEVICE_KEYS.includes(s.key));
		backup.device = {
			id: await getDeviceId(),
			settings: byKey(stripSecrets(portable, 'device', stripped))
		};
	}
	if (stripped.withheld.length > 0) backup.withheld = stripped.withheld;
	if (sections.has('peers')) {
		backup.peers = {
			peers: await db.peers.toArray(),
			revocations: await db.revocations.toArray()
		};
	}
	if (options.secretsPassphrase !== undefined) {
		// Checked even when there is nothing to seal, so a short passphrase is not silently accepted.
		backup.secrets = await sealSecrets(stripped.secrets, options.secretsPassphrase);
	}

	return JSON.stringify(backup);
}

function downloadTextFile(content: string, fileName: string) {
	const blob = new Blob([content], { type: 'text/plain' });
	const url = URL.createObjectURL(blob);

	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;

	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	// Clean up
	setTimeout(() => {
		URL.revokeObjectURL(url);
	}, 1500);
}

/** The shared settings as JSON, without credentials. Sorted, so equal settings give equal text. */
export async function exportSettingsJson(): Promise<string> {
	const stripped = stripSecrets(await settings.getAll(), 'settings', { secrets: {}, withheld: [] });
	return JSON.stringify(byKey(stripped));
}
