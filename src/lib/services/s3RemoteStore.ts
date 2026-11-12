/**
 * The S3 bucket as a `RemoteStore` for delta sync. Every object is encrypted on its own. Delta
 * and snapshot objects are bound to their key (AES-GCM additional data), so one cannot be copied
 * over another or replayed under a new number. The legacy per-device state files
 * (`crdt/<kind>/<deviceId>.ydoc`) predate that and are read as they were written. Objects are
 * also signed by their author inside the encryption (see signedObjects.ts).
 */
import type { RemoteObjectInfo, RemoteStore } from '#lib/sync/remoteStore';
import { openSigned, sealSigned, type SigningContext } from '#lib/sync/signedObjects';
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
	/**
	 * @param signing Signs what is written and checks who wrote what is read (see signedObjects.ts).
	 *   Without it objects are neither signed nor checked: only for tools that read the bucket as it is.
	 */
	constructor(
		private readonly cfg: S3Config,
		private readonly key: CryptoKey,
		private readonly signing?: SigningContext
	) {}

	async list(prefix: string): Promise<RemoteObjectInfo[]> {
		return listObjectInfos(this.cfg, prefix);
	}

	async get(key: string): Promise<Uint8Array | null> {
		const raw = await getObject(this.cfg, key);
		if (!raw) return null;
		const plain = await decryptCrdtObject(this.key, key, raw);
		return this.signing ? openSigned(this.signing, key, plain) : plain;
	}

	async put(
		key: string,
		body: Uint8Array,
		opts: { onlyIfAbsent?: boolean } = {}
	): Promise<boolean> {
		const content = this.signing
			? await sealSigned(this.signing, key, body as Uint8Array<ArrayBuffer>)
			: (body as Uint8Array<ArrayBuffer>);
		const sealed = await encrypt(this.key, content, aadFor(key));
		return putObject(this.cfg, key, sealed, { onlyIfAbsent: opts.onlyIfAbsent });
	}

	async delete(key: string): Promise<void> {
		await deleteObject(this.cfg, key);
	}
}
