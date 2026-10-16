/**
 * Encrypts what another `RemoteStore` holds: AES-256-GCM per object, with the object's key bound
 * in as additional data (see s3Crypto.ts), so one object cannot be copied over another or replayed
 * under a new number. Used for WebDAV; the S3 store does the same inside its own adapter.
 */
import type { RemoteObjectInfo, RemoteStore } from '#lib/sync/remoteStore';
import { decrypt, encrypt } from './s3Crypto';
import { aadFor } from './s3RemoteStore';

export class EncryptedRemoteStore implements RemoteStore {
	/**
	 * @param legacyPlain Read the legacy per-device state files (`<deviceId>.ydoc`) as they are
	 *   stored. WebDAV never encrypted them, and the app no longer writes them.
	 */
	constructor(
		private readonly inner: RemoteStore,
		private readonly key: CryptoKey,
		private readonly legacyPlain = true
	) {}

	private isPlain(key: string): boolean {
		return this.legacyPlain && aadFor(key) === undefined;
	}

	list(prefix: string): Promise<RemoteObjectInfo[]> {
		return this.inner.list(prefix);
	}

	async get(key: string): Promise<Uint8Array | null> {
		const raw = await this.inner.get(key);
		if (!raw || this.isPlain(key)) return raw;
		return decrypt(this.key, raw, aadFor(key));
	}

	async put(
		key: string,
		body: Uint8Array,
		opts: { onlyIfAbsent?: boolean } = {}
	): Promise<boolean> {
		const sealed = this.isPlain(key)
			? body
			: await encrypt(this.key, body as Uint8Array<ArrayBuffer>, aadFor(key));
		return this.inner.put(key, sealed, opts);
	}

	delete(key: string): Promise<void> {
		return this.inner.delete(key);
	}
}
