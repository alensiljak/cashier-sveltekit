import { Posting, ScheduledTransaction, Xact } from '$lib/data/model';

/** Bump when the record shape changes; readers must refuse newer versions. */
export const SCX_SCHEMA_VERSION = 1;

/** Stable record ID of a scheduled transaction in the CRDT store (a ULID). */
export type CrdtScxId = string;

/**
 * A scheduled transaction as stored in the CRDT document: the
 * `ScheduledTransaction` model with a stable string `id` and a `schemaVersion`.
 * Plain JSON data only, so it can be written to a Yjs map as-is. The template
 * `transaction` is one atomic value, so concurrent edits resolve last-writer-wins
 * per scheduled transaction and never interleave postings of two versions.
 */
export type ScxRecord = Omit<ScheduledTransaction, 'id'> & {
	id: CrdtScxId;
	schemaVersion: number;
};

/** A scheduled transaction as the store hands it out: the model, keyed by the store's string id. */
export type StoredScx = Omit<ScheduledTransaction, 'id'> & { id: CrdtScxId };

/** Drop `undefined` values so the record is JSON-clean. */
function clean<T extends object>(obj: T): T {
	return JSON.parse(JSON.stringify(obj)) as T;
}

export function toRecord(scx: Omit<ScheduledTransaction, 'id'>, id: CrdtScxId): ScxRecord {
	const { id: _oldId, ...rest } = scx as ScheduledTransaction;
	const record = clean({ ...rest, id, schemaVersion: SCX_SCHEMA_VERSION });
	// The template's own id would only be meaningful for a stored transaction.
	if (record.transaction) delete record.transaction.id;
	return record;
}

/** True if the record was written by a newer app version than this one. */
export function isNewerSchema(record: ScxRecord): boolean {
	return record.schemaVersion > SCX_SCHEMA_VERSION;
}

const warnedIds = new Set<CrdtScxId>();

/**
 * Best-effort read. A record with a newer schema is still converted, using the
 * fields this version knows about, and a warning is logged once per record.
 * Writing such a record back would drop the newer fields, so callers must not.
 */
export function fromRecord(record: ScxRecord): StoredScx {
	if (isNewerSchema(record) && !warnedIds.has(record.id)) {
		warnedIds.add(record.id);
		console.warn(
			`Scheduled transaction ${record.id} has schema version ${record.schemaVersion}; ` +
				`this app supports up to ${SCX_SCHEMA_VERSION}. Read as-is; update the app.`
		);
		// Imported lazily: the toaster touches `document` on load, which is absent in workers/tests.
		if (typeof document !== 'undefined') {
			void import('$lib/utils/notifier').then(({ default: notifier }) =>
				notifier.warning(
					'Some scheduled transactions were saved by a newer version of the app and may be incomplete. Please update the app.'
				)
			);
		}
	}
	const { schemaVersion: _v, transaction, ...rest } = record;
	// Built on the model class for its defaults; its `id?: number` is overwritten by the string id.
	const scx = Object.assign(new ScheduledTransaction(), rest) as unknown as StoredScx;
	if (transaction) {
		const xact = Object.assign(new Xact(), transaction);
		xact.postings = transaction.postings.map((p) => Object.assign(new Posting(), p));
		scx.transaction = xact;
	}
	return scx;
}
