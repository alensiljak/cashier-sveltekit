/**
 * The little a dumb object store (S3, WebDAV) must offer for delta sync. Keys are relative paths
 * like `crdt/xacts/snap-<ulid>.ydoc`. Adapters add encryption and the transport's own details.
 */
export interface RemoteObjectInfo {
	key: string;
	size: number;
	lastModified: Date | null;
}

export interface RemoteStore {
	/** All objects whose key starts with `prefix`. */
	list(prefix: string): Promise<RemoteObjectInfo[]>;
	/** The object's bytes, or null when it does not exist. */
	get(key: string): Promise<Uint8Array | null>;
	/** Stores an object. With `onlyIfAbsent`, returns false instead of overwriting an existing one. */
	put(key: string, body: Uint8Array, opts?: { onlyIfAbsent?: boolean }): Promise<boolean>;
	delete(key: string): Promise<void>;
}

/** In-memory store, for tests. */
export class MemoryRemoteStore implements RemoteStore {
	readonly objects = new Map<string, { body: Uint8Array; lastModified: Date }>();

	async list(prefix: string): Promise<RemoteObjectInfo[]> {
		return [...this.objects]
			.filter(([key]) => key.startsWith(prefix))
			.map(([key, o]) => ({ key, size: o.body.length, lastModified: o.lastModified }))
			.sort((a, b) => a.key.localeCompare(b.key));
	}

	async get(key: string): Promise<Uint8Array | null> {
		const o = this.objects.get(key);
		return o ? o.body.slice() : null;
	}

	async put(key: string, body: Uint8Array, opts: { onlyIfAbsent?: boolean } = {}) {
		if (opts.onlyIfAbsent && this.objects.has(key)) return false;
		this.objects.set(key, { body: body.slice(), lastModified: new Date() });
		return true;
	}

	async delete(key: string): Promise<void> {
		this.objects.delete(key);
	}
}
