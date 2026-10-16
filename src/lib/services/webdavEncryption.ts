/**
 * Optional encryption of the sync files in the WebDAV folder (the `cashier-<kind>-...` files; the
 * settings backup is not part of it). The switch and the passphrase are device settings. The key
 * is derived from the passphrase with the parameters in `cashier-key.json` in the folder (the
 * same scheme as the S3 bucket's `key.json`), so every device derives the same key, and the
 * file's presence tells whether the folder is encrypted.
 *
 * Turning the switch on or off on one device while the folder is in the other state would leave
 * that device unable to read what the others wrote, so syncing refuses with an
 * `EncryptionMismatchError` until the folder is converted (`convertWebDavFolder`) or the switch is
 * put back.
 */
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import type { RemoteStore } from '#lib/sync/remoteStore';
import type { WebDavClient } from '#lib/utils/webdav';
import { EncryptedRemoteStore } from './encryptedRemoteStore';
import { createKeyParams, decrypt, encrypt, openKey, type KeyParams } from './s3Crypto';
import { aadFor } from './s3RemoteStore';
import { WebDavRemoteStore } from './webdavRemoteStore';

export const KEY_FILE = 'cashier-key.json';

export interface WebDavEncryption {
	enabled: boolean;
	passphrase: string;
}

export async function loadWebDavEncryption(): Promise<WebDavEncryption> {
	const saved = await deviceSettings.get<Partial<WebDavEncryption>>(
		DeviceSettingKeys.webdavEncryption
	);
	return { enabled: !!saved?.enabled, passphrase: saved?.passphrase ?? '' };
}

export async function saveWebDavEncryption(value: WebDavEncryption): Promise<void> {
	await deviceSettings.set(DeviceSettingKeys.webdavEncryption, value);
}

/** The folder and this device disagree about encryption. */
export class EncryptionMismatchError extends Error {
	constructor(readonly mode: 'needs-encrypt' | 'needs-decrypt') {
		super(
			mode === 'needs-encrypt'
				? 'Encryption is on here, but the WebDAV folder is not encrypted yet. Open the WebDAV configuration to encrypt it.'
				: 'The WebDAV folder is encrypted, but encryption is off here. Open the WebDAV configuration to decrypt it, or turn encryption on.'
		);
		this.name = 'EncryptionMismatchError';
	}
}

async function readKeyParams(client: WebDavClient): Promise<KeyParams | null> {
	const res = await client.get(KEY_FILE);
	if (res.status === 404 || res.status === 410) return null;
	if (!res.ok) throw new Error(`${KEY_FILE}: ${res.status} ${res.statusText}`);
	return JSON.parse(await res.text()) as KeyParams;
}

/** Deriving a key takes a few hundred thousand iterations: once per folder, passphrase and salt. */
const keys = new Map<string, CryptoKey>();

async function keyFor(client: WebDavClient, passphrase: string, params: KeyParams) {
	const id = `${client.fileUrl('')}|${passphrase}|${params.salt}`;
	let key = keys.get(id);
	if (!key) {
		key = await openKey(passphrase, params);
		keys.set(id, key);
	}
	return key;
}

/** The folder's key, creating the key file when there is none. Throws `WrongPassphraseError` on mismatch. */
async function createOrOpenKey(client: WebDavClient, passphrase: string): Promise<CryptoKey> {
	let params = await readKeyParams(client);
	if (!params) {
		const created = await createKeyParams(passphrase);
		const res = await client.put(KEY_FILE, JSON.stringify(created.params), 'application/json');
		if (!res.ok) throw new Error(`${KEY_FILE}: ${res.status} ${res.statusText}`);
		// Another device may have written one at the same time: what the folder holds now is the key.
		params = (await readKeyParams(client)) ?? created.params;
	}
	return keyFor(client, passphrase, params);
}

export interface WebDavFolderState {
	/** The folder holds a key file, so its sync files are encrypted. */
	encrypted: boolean;
	/** Sync files in the folder. */
	objects: number;
}

export async function webDavFolderState(client: WebDavClient): Promise<WebDavFolderState> {
	return {
		encrypted: (await readKeyParams(client)) !== null,
		objects: (await new WebDavRemoteStore(client).list('crdt/')).length
	};
}

/**
 * The WebDAV folder as a store for delta sync, encrypted as configured. Throws
 * `EncryptionMismatchError` when the folder and the setting disagree.
 */
export async function remoteFor(client: WebDavClient): Promise<RemoteStore> {
	const plain = new WebDavRemoteStore(client);
	const { enabled, passphrase } = await loadWebDavEncryption();
	const params = await readKeyParams(client);

	if (!enabled) {
		if (params) throw new EncryptionMismatchError('needs-decrypt');
		return plain;
	}
	if (!passphrase)
		throw new Error('Set an encryption passphrase in the WebDAV configuration first.');
	if (!params) {
		if ((await plain.list('crdt/')).length) throw new EncryptionMismatchError('needs-encrypt');
		// An empty folder has nothing to convert: it starts out encrypted.
		return new EncryptedRemoteStore(plain, await createOrOpenKey(client, passphrase));
	}
	return new EncryptedRemoteStore(plain, await keyFor(client, passphrase, params));
}

async function opens(key: CryptoKey, body: Uint8Array, aad: Uint8Array<ArrayBuffer>) {
	try {
		await decrypt(key, body, aad);
		return true;
	} catch {
		return false;
	}
}

export interface ConversionResult {
	converted: number;
	/** Files that were already in the target form, and the legacy files, which are left as they are. */
	skipped: number;
}

/**
 * Encrypts or decrypts every sync file in the folder, and then sets or removes the key file. Can
 * be run again after an interruption: what is already converted is skipped. The legacy per-device
 * state files are left alone (the app removes them once every device has moved on). Other devices
 * should not sync meanwhile; they refuse to, with a mismatch, once the key file changes.
 *
 * The key file comes first when encrypting, so that a second run uses the same key, and goes last
 * when decrypting, so that a second run can still open what is left.
 *
 * @param passphrase For encrypting: the passphrase to set. For decrypting: the folder's.
 */
export async function convertWebDavFolder(
	client: WebDavClient,
	direction: 'encrypt' | 'decrypt',
	passphrase: string,
	onProgress?: (done: number, total: number) => void
): Promise<ConversionResult> {
	const plain = new WebDavRemoteStore(client);
	let key: CryptoKey;
	if (direction === 'encrypt') {
		key = await createOrOpenKey(client, passphrase);
	} else {
		const params = await readKeyParams(client);
		if (!params) return { converted: 0, skipped: 0 };
		key = await keyFor(client, passphrase, params);
	}

	const infos = await plain.list('crdt/');
	let converted = 0;
	let skipped = 0;
	for (const info of infos) {
		const aad = aadFor(info.key);
		const body = aad ? await plain.get(info.key) : null;
		if (!aad || !body) {
			skipped++;
			continue;
		}
		if (direction === 'encrypt') {
			if (await opens(key, body, aad)) {
				skipped++;
				continue;
			}
			await plain.put(info.key, await encrypt(key, body as Uint8Array<ArrayBuffer>, aad));
		} else {
			let content: Uint8Array;
			try {
				content = await decrypt(key, body, aad);
			} catch {
				skipped++; // Already plain.
				continue;
			}
			await plain.put(info.key, content);
		}
		converted++;
		onProgress?.(converted + skipped, infos.length);
	}

	if (direction === 'decrypt') {
		const res = await client.delete(KEY_FILE);
		if (!res.ok && res.status !== 404)
			throw new Error(`${KEY_FILE}: ${res.status} ${res.statusText}`);
	}
	return { converted, skipped };
}
