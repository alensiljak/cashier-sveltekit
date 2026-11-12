/**
 * Signed bucket objects (S3, WebDAV); see doc/projects/2026-11-11_device-identity.md, step 5.
 *
 * Every object a device writes is attributed to it by its name, but every device holds the shared
 * passphrase, so a name proves nothing. A signature by the author's key does. The author is the
 * device in the object's name (`crdt/<kind>/<id>.<seq>.upd`, `.ack`, `manifests/<id>.json`); a
 * snapshot has no device in its name, so its author is named in the signed envelope.
 *
 * Envelope, around the plain content and inside the encryption (so converting a folder between
 * encrypted and plain keeps it intact):
 *   `CSO3` | idLength (1 byte) | author id (ASCII) | signature (64 bytes) | content
 * The signature (ECDSA P-256 / SHA-256) covers `["cashier-obj-v1", objectKey, authorId,
 * hex(SHA-256(content))]`, which ties the object to its name as well as to its author.
 *
 * What is accepted:
 * - An object signed by a key-derived author whose key is known and matches the ID.
 * - An object without an envelope, only from an author whose ID is *not* key-derived: a legacy
 *   UUID, written before the switch to key-derived IDs. Those cannot be signed; they are accepted
 *   until they are forgotten (see the migration in the doc).
 * - An unsigned snapshot, only while this device itself still has a legacy ID. A device with a
 *   key-derived ID takes snapshots only from signed authors.
 * Trust (whether the author may be merged) is a separate question, decided by `ignore`.
 */
import { parseKey } from '#lib/sync/deltaSync';
import { isDerivedId } from '#lib/sync/deviceId';
import { deviceIdFromPublicKey, signMessage, verifyMessage } from '#lib/sync/deviceKey';
import { fromBase64, toBase64, toHex } from '#lib/sync/encoding';
import {
	ObjectRejectedError,
	type RemoteObjectInfo,
	type RemoteStore
} from '#lib/sync/remoteStore';

const MAGIC = new Uint8Array([0x43, 0x53, 0x4f, 0x33]); // "CSO3"
const SIG_BYTES = 64;
const OBJECT_TAG = 'cashier-obj-v1';

export { isDerivedId };

export interface SigningSelf {
	id: string;
	privateKey: CryptoKey;
}

export interface SigningContext {
	/** This device, when its ID is key-derived; null while it still has a legacy ID (nothing is signed). */
	self: SigningSelf | null;
	/** The public key (base64 SPKI) of a device, or null when it is not known. */
	publicKeyOf(deviceId: string): Promise<string | null>;
}

/** Who must have signed an object by its name: a device, a snapshot's own envelope, or nobody (not signed). */
type Role = { author: string } | 'snapshot' | null;

export function roleOf(objectKey: string): Role {
	const manifest = /^manifests\/([^/.]+)\.json$/.exec(objectKey);
	if (manifest) return { author: manifest[1] };
	const kind = /^crdt\/([^/]+)\//.exec(objectKey)?.[1];
	if (kind !== 'xacts' && kind !== 'scx') return null;
	const parsed = parseKey(kind, objectKey);
	if (parsed?.type === 'snapshot') return 'snapshot';
	if (parsed?.type === 'delta' || parsed?.type === 'ack') return { author: parsed.deviceId };
	return null; // Legacy state files predate signing.
}

const hasEnvelope = (bytes: Uint8Array): boolean =>
	bytes.length >= MAGIC.length && MAGIC.every((b, i) => bytes[i] === b);

async function signedMessage(
	objectKey: string,
	author: string,
	content: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
	const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', content));
	return new TextEncoder().encode(JSON.stringify([OBJECT_TAG, objectKey, author, toHex(hash)]));
}

/** Wraps `content` for storing under `objectKey`: signed when this device can sign and the object is of a signed kind. */
export async function sealSigned(
	ctx: SigningContext,
	objectKey: string,
	content: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
	const role = roleOf(objectKey);
	if (!role || !ctx.self) return content;
	const author = role === 'snapshot' ? ctx.self.id : role.author;
	if (author !== ctx.self.id) {
		throw new Error(`Cannot write ${objectKey}: it belongs to another device`);
	}
	const sig = fromBase64(
		await signMessage(ctx.self.privateKey, await signedMessage(objectKey, author, content))
	);
	const id = new TextEncoder().encode(author);
	const out = new Uint8Array(MAGIC.length + 1 + id.length + SIG_BYTES + content.length);
	let at = 0;
	out.set(MAGIC, at);
	out[(at += MAGIC.length)] = id.length;
	out.set(id, (at += 1));
	out.set(sig, (at += id.length));
	out.set(content, (at += SIG_BYTES));
	return out;
}

/** The content of an envelope without checking it, for showing an object. Anything else is returned as it is. */
export function stripSigned(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
	if (!hasEnvelope(bytes)) return bytes;
	const start = MAGIC.length + 1 + bytes[MAGIC.length] + SIG_BYTES;
	return start <= bytes.length ? bytes.subarray(start) : bytes;
}

/**
 * The content of an object read from the store, after checking who wrote it. Throws
 * `ObjectRejectedError` when it must not be used (see the rules at the top of this file).
 */
export async function openSigned(
	ctx: SigningContext,
	objectKey: string,
	stored: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
	const role = roleOf(objectKey);
	if (!role) return stored;
	const reject = (reason: string) => new ObjectRejectedError(objectKey, reason);

	if (!hasEnvelope(stored)) {
		if (role === 'snapshot') {
			if (ctx.self) throw reject('snapshot is not signed');
			return stored;
		}
		if (isDerivedId(role.author)) throw reject('not signed by its device');
		return stored; // A legacy ID: written before objects were signed.
	}

	const idLength = stored[MAGIC.length];
	const idStart = MAGIC.length + 1;
	const sigStart = idStart + idLength;
	const bodyStart = sigStart + SIG_BYTES;
	if (!idLength || bodyStart > stored.length) throw reject('signature header is truncated');
	const author = new TextDecoder().decode(stored.subarray(idStart, sigStart));
	if (role !== 'snapshot' && author !== role.author) {
		throw reject('signed by a different device than the one in its name');
	}
	if (!isDerivedId(author)) throw reject('signed with an ID that is not derived from a key');

	const publicKey = await ctx.publicKeyOf(author);
	if (!publicKey) throw reject(`the key of device ${author.slice(0, 8)} is not known`);
	if ((await deviceIdFromPublicKey(publicKey)) !== author) {
		throw reject('the key on record does not match the device ID');
	}
	const content = stored.subarray(bodyStart);
	const ok = await verifyMessage(
		publicKey,
		toBase64(stored.subarray(sigStart, bodyStart)),
		await signedMessage(objectKey, author, content)
	);
	if (!ok) throw reject('signature does not verify');
	return content;
}

/**
 * Signs what goes in and verifies what comes out. Sits above the encryption, so it sees plain
 * content: `new SignedRemoteStore(new EncryptedRemoteStore(transport, key), ctx)`.
 */
export class SignedRemoteStore implements RemoteStore {
	constructor(
		private readonly inner: RemoteStore,
		private readonly ctx: SigningContext
	) {}

	list(prefix: string): Promise<RemoteObjectInfo[]> {
		return this.inner.list(prefix);
	}

	async get(key: string): Promise<Uint8Array | null> {
		const raw = await this.inner.get(key);
		return raw ? openSigned(this.ctx, key, raw as Uint8Array<ArrayBuffer>) : null;
	}

	async put(
		key: string,
		body: Uint8Array,
		opts: { onlyIfAbsent?: boolean } = {}
	): Promise<boolean> {
		return this.inner.put(
			key,
			await sealSigned(this.ctx, key, body as Uint8Array<ArrayBuffer>),
			opts
		);
	}

	delete(key: string): Promise<void> {
		return this.inner.delete(key);
	}
}
