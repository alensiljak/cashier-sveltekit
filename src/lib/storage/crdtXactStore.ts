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
const META_KEY = 'meta';
const INITIALIZED_FLAG = 'initialized';

/**
 * Working set kept in a Yjs document, persisted to IndexedDB via y-indexeddb.
 * Transactions are identified by a stable record ID, so an ID stays valid
 * across writes. Each record is stored as one plain JSON value in a `Y.Map`,
 * so concurrent edits of the same transaction resolve last-writer-wins per
 * record, while adds/removes of different records merge cleanly.
 */
export class CrdtXactStore implements XactStore {
	readonly kind = 'crdt';

	readonly doc: Y.Doc;
	private readonly records: Y.Map<XactRecord>;
	private readonly meta: Y.Map<boolean>;
	private readonly persistence: IndexeddbPersistence;

	private readonly getOrigin: () => Promise<string>;

	constructor(dbName: string = DB_NAME, getOrigin: () => Promise<string> = getDeviceId) {
		this.getOrigin = getOrigin;
		this.doc = new Y.Doc();
		this.records = this.doc.getMap<XactRecord>(RECORDS_KEY);
		this.meta = this.doc.getMap<boolean>(META_KEY);
		this.persistence = new IndexeddbPersistence(dbName, this.doc);
	}

	/** Resolves once the persisted state has been loaded into the document. */
	private async ready(): Promise<void> {
		await this.persistence.whenSynced;
	}

	/** Initialized once the document carries the flag set by `initialize()` (persisted with it). */
	async isInitialized(): Promise<boolean> {
		await this.ready();
		return this.meta.get(INITIALIZED_FLAG) === true;
	}

	async initialize(): Promise<void> {
		await this.ready();
		this.meta.set(INITIALIZED_FLAG, true);
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

	async clear(): Promise<void> {
		await this.ready();
		this.doc.transact(() => this.records.clear());
		scheduleBackup();
	}
}
