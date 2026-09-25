import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { monotonicFactory } from 'ulid';
import { scheduleBackup } from '$lib/services/webdavAutoBackupService';
import { locateXactsInSource } from '$lib/utils/xactLocator';
import { xactToBeancountText } from '$lib/utils/xactUtils';
import { fromRecord, isNewerSchema, toRecord, type XactRecord } from './crdtXactRecord';
import { getDeviceId } from '$lib/sync/ydocDevices';
import type { StoredXact, XactId, XactStore } from './xactStore';

const DB_NAME = 'cashier-xacts';
const RECORDS_KEY = 'xacts';
// Monotonic, so IDs made within the same millisecond still sort in creation order.
const newId = monotonicFactory();

/** Whether an IndexedDB database of this name exists, without creating it. */
async function databaseExists(name: string): Promise<boolean> {
	if (!indexedDB.databases) return false;
	return (await indexedDB.databases()).some((d) => d.name === name);
}

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Working set kept in a Yjs document, persisted to IndexedDB via y-indexeddb.
 * Transactions are identified by a stable record ID, so an ID stays valid
 * across writes. Each record is stored as one plain JSON value in a `Y.Map`,
 * so concurrent edits of the same transaction resolve last-writer-wins per
 * record, while adds/removes of different records merge cleanly.
 *
 * The IndexedDB database is opened (and so created) on first use, not in the
 * constructor, so its existence tells whether the store was set up on this
 * device; see `isInitialized()`.
 */
export class CrdtXactStore implements XactStore {
	readonly kind = 'crdt';

	readonly doc: Y.Doc;
	private readonly records: Y.Map<XactRecord>;
	private opening?: Promise<void>;
	private existedBeforeOpen?: Promise<boolean>;
	private initializedHere = false;

	private readonly dbName: string;
	private readonly getOrigin: () => Promise<string>;

	constructor(dbName: string = DB_NAME, getOrigin: () => Promise<string> = getDeviceId) {
		this.dbName = dbName;
		this.getOrigin = getOrigin;
		this.doc = new Y.Doc();
		this.records = this.doc.getMap<XactRecord>(RECORDS_KEY);
	}

	/** Whether the database existed before this store first opened it (memoized, so opening can't change the answer). */
	private existed(): Promise<boolean> {
		return (this.existedBeforeOpen ??= databaseExists(this.dbName));
	}

	/** Opens the database if needed and resolves once its state is loaded into the document. */
	private async ready(): Promise<void> {
		this.opening ??= (async () => {
			await this.existed();
			await new IndexeddbPersistence(this.dbName, this.doc).whenSynced;
		})();
		await this.opening;
	}

	/**
	 * Initialized once the IndexedDB database exists, i.e. the store was opened
	 * on this device before (by `initialize()`, or by merging in another
	 * device's state). Nothing is kept inside the document for this.
	 */
	async isInitialized(): Promise<boolean> {
		return this.initializedHere || (await this.existed());
	}

	/** Creates the (empty) database. */
	async initialize(): Promise<void> {
		await this.ready();
		this.initializedHere = true;
	}

	/** Parse a single transaction from Beancount text. */
	private async parse(beancountText: string) {
		const [location] = await locateXactsInSource(beancountText);
		if (!location) throw new Error('No transaction found in the given text');
		return location.xact;
	}

	/** Records in date order; the ID breaks ties so the order is deterministic. */
	private sorted(): XactRecord[] {
		return [...this.records.values()].sort(
			(a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id)
		);
	}

	private put(id: XactId, record: XactRecord): StoredXact {
		this.records.set(id, record);
		scheduleBackup();
		return { xact: fromRecord(record), id, origin: record.origin };
	}

	async append(beancountText: string): Promise<StoredXact> {
		await this.ready();
		const xact = await this.parse(beancountText);
		const id = newId();
		return this.put(id, toRecord(xact, id, await this.getOrigin()));
	}

	async update(id: XactId, beancountText: string): Promise<StoredXact> {
		await this.ready();
		const existing = this.records.get(id);
		if (!existing) throw new Error(`Transaction ${id} not found`);
		if (isNewerSchema(existing)) {
			// Rewriting would drop fields this version doesn't know about.
			throw new Error(
				`Transaction ${id} was written by a newer app version (schema ${existing.schemaVersion}) and cannot be edited here. Update the app.`
			);
		}
		const xact = await this.parse(beancountText);
		// The creator stays the origin; records predating origin tracking stay without one.
		return this.put(id, toRecord(xact, id, existing.origin));
	}

	async remove(id: XactId): Promise<void> {
		await this.ready();
		this.records.delete(id);
		scheduleBackup();
	}

	async list(): Promise<StoredXact[]> {
		await this.ready();
		return this.sorted().map((r) => ({ xact: fromRecord(r), id: r.id, origin: r.origin }));
	}

	/** Number of records per creating device; records without an origin count under `''`. */
	async originCounts(): Promise<Record<string, number>> {
		await this.ready();
		const counts: Record<string, number> = {};
		for (const r of this.records.values()) {
			const key = r.origin ?? '';
			counts[key] = (counts[key] ?? 0) + 1;
		}
		return counts;
	}

	async toBeancount(): Promise<string> {
		await this.ready();
		const records = this.sorted();
		if (records.length === 0) return '';
		return records.map((r) => xactToBeancountText(fromRecord(r)).trimEnd()).join('\n\n') + '\n';
	}

	/** The full document state as a Yjs update, for backup or relay to other devices. */
	async exportState(): Promise<Uint8Array> {
		await this.ready();
		return Y.encodeStateAsUpdate(this.doc);
	}

	/** Merge a Yjs update (e.g. another device's exported state) into the document. Idempotent. */
	async importState(update: Uint8Array): Promise<void> {
		await this.ready();
		Y.applyUpdate(this.doc, update);
		// Merged records reach other devices through this device's own file too.
		scheduleBackup();
	}

	/** State vector, describing which updates this document already has. */
	async stateVector(): Promise<Uint8Array> {
		await this.ready();
		return Y.encodeStateVector(this.doc);
	}

	/**
	 * Hash of the document's content: the state vector plus the delete set, so
	 * deletions count too. Equal on two devices exactly when they hold the same
	 * records.
	 */
	async contentHash(): Promise<string> {
		await this.ready();
		return sha256Hex(Y.encodeSnapshot(Y.snapshot(this.doc)) as Uint8Array<ArrayBuffer>);
	}

	/**
	 * Two-way sync step for a peer: merges the peer's full state and returns the
	 * updates the peer is still missing, computed from the state vector of what
	 * it sent.
	 */
	async mergeAndDiff(remoteState: Uint8Array): Promise<Uint8Array> {
		const remoteVector = Y.encodeStateVectorFromUpdate(remoteState);
		await this.importState(remoteState);
		return Y.encodeStateAsUpdate(this.doc, remoteVector);
	}

	async clear(): Promise<void> {
		await this.ready();
		this.doc.transact(() => this.records.clear());
		scheduleBackup();
	}
}
