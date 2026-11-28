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
	type BackupSection,
	type DeviceData,
	type PeersData,
	type StoredSetting
} from './model';
import { CREDENTIAL_SETTINGS, PORTABLE_DEVICE_KEYS, type SettingStore } from './rules';
import {
	checkPassphrase,
	holdsSecret,
	sealSecrets,
	secretId,
	stripSecrets,
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
	credentials?: string[];
	secrets?: SecretsBlock;
}

const byKey = (list: StoredSetting[]) => list.sort((a, b) => a.key.localeCompare(b.key));

export function getBackupFilename(): string {
	// filename
	const now = new Date();
	const date = formatDate(now, ISODATEFORMAT);
	const time = formatDate(now, LONGTIMEFORMAT);
	const filename = `cashier-backup_${date}_${time}.json.gz`;

	return filename;
}

export interface BackupOptions {
	/** What goes into the file, apart from the credentials. Everything when left out. */
	sections?: Exclude<BackupSection, 'credentials'>[];
	/**
	 * Set to include the credentials, encrypted with this passphrase: all of them, whatever the
	 * sections. Without it, the file has none.
	 */
	secretsPassphrase?: string;
}

/** Gzips a backup, which is how it is saved. */
export async function compressBackup(content: string): Promise<Uint8Array<ArrayBuffer>> {
	const stream = new Response(content).body!.pipeThrough(new CompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Generates backup file and sends it via download.
 */
export async function createBackupFile(filename: string, options?: BackupOptions) {
	const output = await compressBackup(await createBackup(options));

	downloadFile(new Blob([output], { type: 'application/gzip' }), filename);
}

/** Every setting that holds a secret, whole and as stored, by `secretId`. */
async function collectCredentials() {
	const tables: Record<SettingStore, StoredSetting[]> = {
		settings: (await settings.getAllWithSecrets()) as StoredSetting[],
		device: (await deviceSettings.getAllWithSecrets()) as StoredSetting[]
	};
	const secrets: Record<string, string> = {};
	const labels: string[] = [];
	for (const setting of CREDENTIAL_SETTINGS) {
		const stored = tables[setting.store].find((s) => s.key === setting.key);
		if (!stored || !holdsSecret(stored.value, setting)) continue;
		secrets[secretId(setting)] = stored.value;
		labels.push(setting.label);
	}
	return { secrets, labels };
}

/**
 * Create backup content as text, not compressed yet.
 *
 * The device's own signing key is never in the file: it is not extractable by design, so a
 * restored device is a new device (see restoredDevice.ts).
 * @returns Text containing the backup content.
 */
export async function createBackup(options: BackupOptions = {}) {
	const sections = new Set<BackupSection>(options.sections ?? ALL_SECTIONS);
	// Checked first, and even when there is nothing to seal.
	if (options.secretsPassphrase !== undefined) checkPassphrase(options.secretsPassphrase);
	const withheld: string[] = [];
	const stripped = { secrets: {}, withheld };
	const backup: BackupFile = { version: BACKUP_VERSION };

	if (sections.has('settings')) {
		backup.settings = byKey(stripSecrets(await settings.getAllWithSecrets(), 'settings', stripped));
	}
	if (sections.has('scx')) {
		backup.scx = toBase64(await (await getReadyScxStore()).exportState());
	}
	if (sections.has('workingSet')) {
		backup.workingSet = toBase64(await (await getXactStore()).exportState());
	}
	if (sections.has('device')) {
		const all = (await deviceSettings.getAllWithSecrets()) as StoredSetting[];
		const portable = all.filter((s) => PORTABLE_DEVICE_KEYS.includes(s.key));
		backup.device = {
			id: await getDeviceId(),
			settings: byKey(stripSecrets(portable, 'device', stripped))
		};
		backup.peers = {
			peers: await db.peers.toArray(),
			revocations: await db.revocations.toArray()
		};
	}
	if (withheld.length > 0) backup.withheld = withheld;
	if (options.secretsPassphrase !== undefined) {
		const { secrets, labels } = await collectCredentials();
		if (labels.length > 0) {
			backup.credentials = labels;
			backup.secrets = await sealSecrets(secrets, options.secretsPassphrase);
		}
	}

	return JSON.stringify(backup);
}

function downloadFile(blob: Blob, fileName: string) {
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
