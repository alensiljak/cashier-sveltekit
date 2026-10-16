/**
 * The S3 bucket as a `RemoteStore` for delta sync. Every object is encrypted on its own. Delta
 * and snapshot objects are bound to their key (AES-GCM additional data), so one cannot be copied
 * over another or replayed under a new number. The legacy per-device state files
 * (`crdt/<kind>/<deviceId>.ydoc`) predate that and are read as they were written.
 */
import type { RemoteObjectInfo, RemoteStore } from '#lib/sync/remoteStore';
import type { S3Config } from './s3Config';
import { deleteObject, getObject, listObjectInfos, putObject } from './s3Client';
import { decrypt, encrypt } from './s3Crypto';

/** `crdt/<kind>/<deviceId>.ydoc`, but not `crdt/<kind>/snap-<id>.ydoc`. */
const LEGACY_STATE_FILE = /^crdt\/[^/]+\/(?!snap-)[^/]+\.ydoc$/;

/** Additional data that binds an object to its key; none for the legacy state files. */
export function aadFor(objectKey: string): Uint8Array<ArrayBuffer> | undefined {
	return LEGACY_STATE_FILE.test(objectKey) ? undefined : new TextEncoder().encode(objectKey);
}

/** Decrypts a CRDT object read from the bucket, as `S3RemoteStore.get` does. */
export const decryptCrdtObject = (key: CryptoKey, objectKey: string, raw: Uint8Array) =>
	decrypt(key, raw, aadFor(objectKey));

export class S3RemoteStore implements RemoteStore {
	constructor(
		private readonly cfg: S3Config,
		private readonly key: CryptoKey
	) {}

	async list(prefix: string): Promise<RemoteObjectInfo[]> {
		return listObjectInfos(this.cfg, prefix);
	}

	async get(key: string): Promise<Uint8Array | null> {
		const raw = await getObject(this.cfg, key);
		return raw ? decryptCrdtObject(this.key, key, raw) : null;
	}

	async put(
		key: string,
		body: Uint8Array,
		opts: { onlyIfAbsent?: boolean } = {}
	): Promise<boolean> {
		const sealed = await encrypt(this.key, body as Uint8Array<ArrayBuffer>, aadFor(key));
		return putObject(this.cfg, key, sealed, { onlyIfAbsent: opts.onlyIfAbsent });
	}

	async delete(key: string): Promise<void> {
		await deleteObject(this.cfg, key);
	}
}
