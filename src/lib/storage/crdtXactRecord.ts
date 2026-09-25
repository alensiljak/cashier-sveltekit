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
	/** ID of the device that created the record. Optional: older records lack it. */
	origin?: string;
	postings: Posting[];
};

/** Drop `undefined` values so the record is JSON-clean. */
function clean<T extends object>(obj: T): T {
	return JSON.parse(JSON.stringify(obj)) as T;
}

export function toRecord(xact: Xact, id: XactId, origin?: string): XactRecord {
	const { id: _ledgerId, ...rest } = xact;
	return clean({ ...rest, id, schemaVersion: XACT_SCHEMA_VERSION, origin });
}

/** True if the record was written by a newer app version than this one. */
export function isNewerSchema(record: XactRecord): boolean {
	return record.schemaVersion > XACT_SCHEMA_VERSION;
}

const warnedIds = new Set<XactId>();

/**
 * Best-effort read. A record with a newer schema is still converted, using the
 * fields this version knows about, and a warning is logged once per record.
 * Writing such a record back would drop the newer fields, so callers must not.
 */
export function fromRecord(record: XactRecord): Xact {
	if (isNewerSchema(record) && !warnedIds.has(record.id)) {
		warnedIds.add(record.id);
		console.warn(
			`Transaction ${record.id} has schema version ${record.schemaVersion}; ` +
				`this app supports up to ${XACT_SCHEMA_VERSION}. Read as-is; update the app.`
		);
		// Imported lazily: the toaster touches `document` on load, which is absent in workers/tests.
		if (typeof document !== 'undefined') {
			void import('$lib/utils/notifier').then(({ default: notifier }) =>
				notifier.warning(
					'Some transactions were saved by a newer version of the app and may be incomplete. Please update the app.'
				)
			);
		}
	}
	const { id: _id, schemaVersion: _v, origin: _o, postings, ...rest } = record;
	const xact = Object.assign(new Xact(), rest);
	xact.postings = postings.map((p) => Object.assign(new Posting(), p));
	return xact;
}
