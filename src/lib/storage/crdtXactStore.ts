import { monotonicFactory } from 'ulid';
import { scheduleBackup } from '$lib/services/webdavAutoBackupService';
import type { DirectiveJson } from '@rustledger/wasm';
import { createParsedLedger, ensureInitialized } from '$lib/services/rustledger';
import { directiveToXact } from '$lib/utils/transactionParser';
import { xactToBeancountText } from '$lib/utils/xactUtils';
import { fromRecord, isNewerSchema, toRecord, type XactRecord } from './crdtXactRecord';
import { getDeviceId } from '$lib/sync/ydocDevices';
import { CrdtDocStore } from './crdtDocStore';
import type { Xact } from '$lib/data/model';

/**
 * Stable record ID of a transaction in the working set (a ULID). Opaque to
 * callers: only pass back what the store gave them.
 *
 * Not to be confused with the full ledger's numeric transaction id (`rledgerId`),
 * which exists only for read-only, already-archived transactions.
 */
export type XactId = string;

export interface StoredXact {
	xact: Xact;
	id: XactId;
	/** ID of the device that created the transaction. */
	origin?: string;
}

const DB_NAME = 'cashier-xacts';
const RECORDS_KEY = 'xacts';
// Monotonic, so IDs made within the same millisecond still sort in creation order.
const newId = monotonicFactory();

/**
 * The device's working set of transactions (the unarchived ones), kept in a
 * Yjs document and persisted to IndexedDB via y-indexeddb. Get the shared
 * instance through `getXactStore()` in `xactStoreRegistry.ts`.
 *
 * Transactions are identified by a stable record ID, so an ID stays valid
 * across writes. Opening, state export/merge and change subscription come from
 * `CrdtDocStore`.
 */
export class CrdtXactStore extends CrdtDocStore<XactRecord> {
	protected readonly kind = 'xacts';
	private readonly getOrigin: () => Promise<string>;

	constructor(dbName: string = DB_NAME, getOrigin: () => Promise<string> = getDeviceId) {
		super(dbName, RECORDS_KEY);
		this.getOrigin = getOrigin;
	}

	/** Parse a single transaction from Beancount text. */
	private async parse(beancountText: string) {
		await ensureInitialized();
		const ledger = createParsedLedger(beancountText);
		if (!ledger) throw new Error('Beancount parser is not available');
		try {
			// Records aren't tied to file positions, so no span lookup is needed.
			const directive = (ledger.getDirectives() as DirectiveJson[]).find(
				(d) => d.type === 'transaction'
			);
			if (!directive) throw new Error('No transaction found in the given text');
			return directiveToXact(directive, beancountText);
		} finally {
			ledger.free();
		}
	}

	/** Records in date order; the ID breaks ties so the order is deterministic. */
	private sorted(): XactRecord[] {
		return [...this.records.values()].sort(
			(a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id)
		);
	}

	/** Writes the record and resolves once it is committed to IndexedDB. */
	private async put(id: XactId, record: XactRecord): Promise<StoredXact> {
		this.records.set(id, record);
		scheduleBackup(this.kind);
		await this.flush();
		return { xact: fromRecord(record), id, origin: record.origin };
	}

	async append(beancountText: string): Promise<StoredXact> {
		await this.ready();
		const xact = await this.parse(beancountText);
		const id = newId();
		return this.put(id, toRecord(xact, id, await this.getOrigin()));
	}

	/**
	 * Adds many transactions in one Yjs transaction, so they persist and sync as a
	 * single update and observers are notified once.
	 */
	async appendMany(xacts: Xact[]): Promise<XactId[]> {
		await this.ready();
		const origin = await this.getOrigin();
		const ids: XactId[] = [];
		this.doc.transact(() => {
			for (const xact of xacts) {
				const id = newId();
				this.records.set(id, toRecord(xact, id, origin));
				ids.push(id);
			}
		});
		if (ids.length > 0) scheduleBackup(this.kind);
		await this.flush();
		return ids;
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
		scheduleBackup(this.kind);
		await this.flush();
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
}
