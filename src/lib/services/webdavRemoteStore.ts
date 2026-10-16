/**
 * A WebDAV folder as a `RemoteStore` for delta sync. The folder is flat: the protocol's key
 * `crdt/<kind>/<name>` is the file `cashier-<kind>-<name>`, which is also what the older per-device
 * state files were called (`cashier-xacts-<deviceId>.ydoc`), so those are still found as legacy
 * files. Content is stored as it is: WebDAV sync has never been encrypted.
 *
 * No conditional PUT: a custom request header would need the server's CORS settings to allow it,
 * and every object is written by one device under a name only it uses (or a fresh ULID), so an
 * existence check is enough.
 */
import type { RemoteObjectInfo, RemoteStore } from '#lib/sync/remoteStore';
import type { WebDavClient } from '#lib/utils/webdav';

/** The file name for a protocol key, or null when the key is not one of ours. */
export function fileNameOf(key: string): string | null {
	const m = /^crdt\/([^/]+)\/([^/]+)$/.exec(key);
	return m ? `cashier-${m[1]}-${m[2]}` : null;
}

/** The protocol key for a file in the folder, or null for any other file. */
export function keyOfFile(name: string): string | null {
	const m = /^cashier-(xacts|scx)-(.+)$/.exec(name);
	return m ? `crdt/${m[1]}/${m[2]}` : null;
}

const fail = (name: string, res: Response) =>
	new Error(`${name}: ${res.status} ${res.statusText}`.trim());

export class WebDavRemoteStore implements RemoteStore {
	constructor(private readonly client: WebDavClient) {}

	private fileOf(key: string): string {
		const name = fileNameOf(key);
		if (!name) throw new Error(`Not a sync object: ${key}`);
		return name;
	}

	async list(prefix: string): Promise<RemoteObjectInfo[]> {
		const infos: RemoteObjectInfo[] = [];
		for (const e of await this.client.list()) {
			const key = e.isDirectory ? null : keyOfFile(e.name);
			if (key?.startsWith(prefix)) {
				infos.push({ key, size: e.size ?? 0, lastModified: e.lastModified });
			}
		}
		return infos.sort((a, b) => a.key.localeCompare(b.key));
	}

	async get(key: string): Promise<Uint8Array | null> {
		const name = this.fileOf(key);
		const res = await this.client.get(name);
		if (res.status === 404 || res.status === 410) return null;
		if (!res.ok) throw fail(name, res);
		return new Uint8Array(await res.arrayBuffer());
	}

	async put(
		key: string,
		body: Uint8Array,
		opts: { onlyIfAbsent?: boolean } = {}
	): Promise<boolean> {
		const name = this.fileOf(key);
		// Absent unless a HEAD says it is there: a server that refuses HEAD must not make every
		// upload look like a name clash (`exists` answers "yes" to anything but 404).
		if (opts.onlyIfAbsent && (await this.client.lastModified(name))) return false;
		const res = await this.client.put(name, body, 'application/octet-stream');
		if (!res.ok) throw fail(name, res);
		return true;
	}

	async delete(key: string): Promise<void> {
		const name = this.fileOf(key);
		const res = await this.client.delete(name);
		if (!res.ok && res.status !== 404) throw fail(name, res);
	}
}
