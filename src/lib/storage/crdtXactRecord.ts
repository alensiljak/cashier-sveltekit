import { Posting, Xact } from '$lib/data/model';
import type { XactId } from './xactStore';

/** Bump when the record shape changes; readers must refuse newer versions. */
export const XACT_SCHEMA_VERSION = 1;

/**
 * A transaction as stored in the CRDT document: the `Xact` model with a stable
 * string `id` (replacing the ledger's numeric one) and a `schemaVersion`.
 * Plain JSON data only, so it can be written to a Yjs map as-is.
 */
export type XactRecord = Omit<Xact, 'id' | 'postings'> & {
	id: XactId;
	schemaVersion: number;
	postings: Posting[];
};

/** Drop `undefined` values so the record is JSON-clean. */
function clean<T extends object>(obj: T): T {
	return JSON.parse(JSON.stringify(obj)) as T;
}

export function toRecord(xact: Xact, id: XactId): XactRecord {
	const { id: _ledgerId, ...rest } = xact;
	return clean({ ...rest, id, schemaVersion: XACT_SCHEMA_VERSION });
}

export function fromRecord(record: XactRecord): Xact {
	if (record.schemaVersion > XACT_SCHEMA_VERSION) {
		throw new Error(
			`Transaction ${record.id} has schema version ${record.schemaVersion}; ` +
				`this app supports up to ${XACT_SCHEMA_VERSION}. Update the app.`
		);
	}
	const { id: _id, schemaVersion: _v, postings, ...rest } = record;
	const xact = Object.assign(new Xact(), rest);
	xact.postings = postings.map((p) => Object.assign(new Posting(), p));
	return xact;
}
