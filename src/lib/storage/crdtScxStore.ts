import { monotonicFactory } from 'ulid';
import { scheduleBackup } from '#lib/services/webdavAutoBackupService';
import type { ScheduledTransaction } from '#lib/data/model';
import { CrdtDocStore } from './crdtDocStore';
import {
	fromRecord,
	isNewerSchema,
	toRecord,
	type CrdtScxId,
	type ScxRecord,
	type StoredScx
} from './crdtScxRecord';

const DB_NAME = 'cashier-scx';
const RECORDS_KEY = 'scx';
const newId = monotonicFactory();

/** `value` with the keys of every object sorted, so that their order does not matter. */
function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => [k, sortKeys(v)])
	);
}

/** What a scheduled transaction says, apart from its ID, as comparable text. */
const contentOf = (scx: Omit<ScheduledTransaction, 'id'>): string =>
	JSON.stringify(sortKeys(toRecord(scx, '')));

/**
 * The scheduled transactions, kept in their own Yjs document (separate from
 * the working set, which is cleared once its transactions are archived) and
 * persisted to IndexedDB. Get the shared instance through `getScxStore()` in
 * `scxStoreRegistry.ts`.
 *
 * Scheduled transactions are identified by a stable record ID, so an ID stays
 * valid across writes and devices. Opening, state export/merge and change
 * subscription come from `CrdtDocStore`.
 */
export class CrdtScxStore extends CrdtDocStore<ScxRecord> {
	protected readonly kind = 'scx';

	constructor(dbName: string = DB_NAME) {
		super(dbName, RECORDS_KEY);
	}

	/** Records by next date; the ID breaks ties so the order is deterministic. */
	private sorted(): ScxRecord[] {
		return [...this.records.values()].sort(
			(a, b) => (a.nextDate ?? '').localeCompare(b.nextDate ?? '') || a.id.localeCompare(b.id)
		);
	}

	/** Writes `scx` under `id`, refusing to overwrite a record written by a newer app version. */
	private put(scx: Omit<ScheduledTransaction, 'id'>, id: CrdtScxId): CrdtScxId {
		const existing = this.records.get(id);
		if (existing && isNewerSchema(existing)) {
			// Rewriting would drop fields this version doesn't know about.
			throw new Error(
				`Scheduled transaction ${id} was written by a newer app version (schema ${existing.schemaVersion}) and cannot be edited here. Update the app.`
			);
		}
		this.records.set(id, toRecord(scx, id));
		return id;
	}

	async list(): Promise<StoredScx[]> {
		await this.ready();
		return this.sorted().map(fromRecord);
	}

	async get(id: CrdtScxId): Promise<StoredScx | undefined> {
		await this.ready();
		const record = this.records.get(id);
		return record ? fromRecord(record) : undefined;
	}

	async count(): Promise<number> {
		await this.ready();
		return this.records.size;
	}

	/** Scheduled transactions whose next date is exactly `date` (YYYY-MM-DD). */
	async dueOn(date: string): Promise<StoredScx[]> {
		await this.ready();
		return this.sorted()
			.filter((r) => r.nextDate === date)
			.map(fromRecord);
	}

	/**
	 * The ID a record is stored under: its own if it is a store ID (a string),
	 * otherwise a new one. So records from a backup or another device keep their
	 * identity, while new ones and legacy numeric ones get a fresh ID.
	 */
	private idFor(scx: { id?: unknown }): CrdtScxId {
		return typeof scx.id === 'string' && scx.id ? scx.id : newId();
	}

	/** Updates the record under `scx.id`, or adds a new one (with a new ID) if it has none. Returns the ID. */
	async save(scx: Omit<ScheduledTransaction, 'id'> & { id?: unknown }): Promise<CrdtScxId> {
		await this.ready();
		const id = this.put(scx, this.idFor(scx));
		scheduleBackup(this.kind);
		await this.flush();
		return id;
	}

	/**
	 * Adds many records (IDs as for `save`) in one Yjs transaction, so they persist
	 * and sync as a single update and observers are notified once. Returns their IDs.
	 */
	async addMany(
		list: (Omit<ScheduledTransaction, 'id'> & { id?: unknown })[]
	): Promise<CrdtScxId[]> {
		await this.ready();
		const ids: CrdtScxId[] = [];
		this.doc.transact(() => {
			for (const scx of list) ids.push(this.put(scx, this.idFor(scx)));
		});
		if (ids.length > 0) scheduleBackup(this.kind);
		await this.flush();
		return ids;
	}

	/** Replaces all records with `list` (IDs as for `save`), in one Yjs transaction. Returns their IDs. */
	async replaceAll(
		list: (Omit<ScheduledTransaction, 'id'> & { id?: unknown })[]
	): Promise<CrdtScxId[]> {
		await this.ready();
		const ids: CrdtScxId[] = [];
		this.doc.transact(() => {
			this.records.clear();
			for (const scx of list) ids.push(this.put(scx, this.idFor(scx)));
		});
		scheduleBackup(this.kind);
		await this.flush();
		return ids;
	}

	/**
	 * The entries of a list without history (an older backup file) that this store does not hold:
	 * those whose ID is not here. An entry without a store ID (a legacy numeric one) is given a new
	 * ID when added, so it counts as held when a record has the same content.
	 */
	async missingFrom(list: ScheduledTransaction[]): Promise<ScheduledTransaction[]> {
		await this.ready();
		const contents = new Set([...this.records.values()].map(contentOf));
		const ids = new Set(this.records.keys());
		return list.filter((scx: { id?: unknown }) => {
			if (typeof scx.id !== 'string' || !scx.id) {
				return !contents.has(contentOf(scx as ScheduledTransaction));
			}
			if (ids.has(scx.id)) return false;
			ids.add(scx.id);
			return true;
		});
	}

	/** Adds what `missingFrom` finds; existing records stay as they are. Returns the new IDs. */
	async addMissing(list: ScheduledTransaction[]): Promise<CrdtScxId[]> {
		return this.addMany(await this.missingFrom(list));
	}

	async remove(id: CrdtScxId): Promise<void> {
		await this.removeMany([id]);
	}

	async removeMany(ids: CrdtScxId[]): Promise<void> {
		await this.ready();
		this.doc.transact(() => {
			for (const id of ids) this.records.delete(id);
		});
		if (ids.length > 0) scheduleBackup(this.kind);
		await this.flush();
	}
}
