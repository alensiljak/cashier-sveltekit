/** Readable content of bucket objects, for the S3 explorer. */
import * as Y from 'yjs';
import { decodeSnapshot, vectorOf } from '#lib/sync/deltaSync';
import { stripSigned } from '#lib/sync/signedObjects';
import { getObject } from './s3Client';
import type { S3Config } from './s3Config';
import { decrypt } from './s3Crypto';
import { decryptCrdtObject } from './s3RemoteStore';
/**
 * Readable content of a bucket object, decrypted on the fly. Yjs state files are shown as the
 * records they hold. Files that are not text are described instead of shown.
 */
export async function previewObject(
	cfg: S3Config,
	key: CryptoKey,
	objectKey: string
): Promise<string> {
	const raw = await getObject(cfg, objectKey);
	if (!raw) throw new Error('The object no longer exists');
	// key.json holds only key-derivation parameters and is not encrypted.
	let bytes: Uint8Array<ArrayBuffer>;
	if (objectKey === 'key.json') bytes = raw;
	// The signature header is not shown; checking it is the sync's job.
	else if (objectKey.startsWith('crdt/') || objectKey.startsWith('devices/')) {
		bytes = stripSigned(await decryptCrdtObject(key, objectKey, raw));
	} else bytes = stripSigned(await decrypt(key, raw));

	const records = (update: Uint8Array) => {
		const doc = new Y.Doc();
		Y.applyUpdate(doc, update);
		const out: Record<string, unknown> = {};
		for (const name of doc.share.keys()) out[name] = doc.getMap(name).toJSON();
		return out;
	};

	if (objectKey.endsWith('.upd')) {
		// A delta holds changes, not records: show what it reaches, and what it carries.
		const structs = Y.decodeUpdate(bytes).structs;
		return JSON.stringify(
			{
				delta: true,
				structs: structs.length,
				reaches: Object.fromEntries(vectorOf(bytes)),
				records: records(bytes)
			},
			null,
			2
		);
	}
	if (/\/snap-[^/]+\.ydoc$/.test(objectKey)) {
		const { coverage, update } = decodeSnapshot(bytes);
		return JSON.stringify({ coverage, ...records(update) }, null, 2);
	}
	if (objectKey.endsWith('.ydoc')) return JSON.stringify(records(bytes), null, 2);

	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return `[Binary content, ${bytes.length} bytes]`;
	}
	if (objectKey.endsWith('.json')) {
		try {
			return JSON.stringify(JSON.parse(text), null, 2);
		} catch {
			// Show it as it is.
		}
	}
	return text;
}
