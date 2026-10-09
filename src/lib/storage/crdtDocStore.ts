import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { ulid } from 'ulid';
import notifier from '#lib/utils/notifier';
import { scheduleBackup } from '#lib/services/webdavAutoBackupService';
import type { DocKind } from '#lib/sync/ydocDevices';

/** Transaction origin of updates merged in from another device, so live sync doesn't echo them back. */
export const REMOTE_ORIGIN = 'remote';

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

/** Name of the top-level `Y.Map` holding the reset marker (see `CrdtDocStore.reset()`). */
const META_KEY = 'meta';

/**
 * Marks a document as the product of a reset. `resetId` is a ULID, so a later reset sorts
 * higher; `retired` is the state vector (client -> clock) of everything that existed before,
 * which this document must never take back in.
 */
interface ResetMeta {
	resetId: string;
	retired: Record<string, number>;
}

type UpdateHandler = (update: Uint8Array, origin: unknown) => void;

function readMeta(doc: Y.Doc): ResetMeta {
	const meta = doc.getMap<unknown>(META_KEY);
	return {
		resetId: (meta.get('resetId') as string | undefined) ?? '',
		retired: (meta.get('retired') as Record<string, number> | undefined) ?? {}
	};
}

/** The reset marker carried by a Yjs update; empty when the update has none (e.g. an incremental one). */
function readUpdateMeta(update: Uint8Array): ResetMeta {
	const scratch = new Y.Doc();
	try {
		Y.applyUpdate(scratch, update);
		return readMeta(scratch);
	} finally {
		scratch.destroy();
	}
}

/** Whether the update carries operations that predate a reset, i.e. come from a retired generation. */
function hasRetiredOps(update: Uint8Array, retired: Record<string, number>): boolean {
	return Y.decodeUpdate(update).structs.some((s) => {
		const limit = retired[s.id.client];
		return limit !== undefined && s.id.clock < limit;
	});
}

const toVector = (retired: Record<string, number>) =>
	new Map(Object.entries(retired).map(([client, clock]) => [Number(client), clock]));

/** One record's change caused by merging in another device's state. */
export interface RecordChange<R> {
	id: string;
	action: 'add' | 'update' | 'delete';
	/** The record before the merge; absent for an add. */
	before?: R;
	/** The record after the merge; absent for a delete. */
	after?: R;
}

/**
 * A keyed collection of plain JSON records, kept in a Yjs document and
 * persisted to its own IndexedDB database via y-indexeddb. Holds everything
 * that doesn't depend on what the records are: opening and initialisation, state
 * export/merge for backup and sync, change subscription.
 *
 * Each record is one plain JSON value in a `Y.Map`, so concurrent edits of the
 * same record resolve last-writer-wins per record, while adds/removes of
 * different records merge cleanly.
 *
 * The IndexedDB database is opened (and so created) on first use, not in the
 * constructor, so its existence tells whether the store was set up on this
 * device; see `isInitialized()`.
 */
export abstract class CrdtDocStore<R> {
	// Replaced by `reset()` and by adopting another device's reset, so callers must not
	// hold on to `doc`/`records`; use `subscribe()` and `onUpdate()`, which survive a swap.
	private _doc: Y.Doc;
	private _records: Y.Map<R>;
	private opening?: Promise<void>;
	private persistence?: IndexeddbPersistence;
	private existedBeforeOpen?: Promise<boolean>;
	private initializedHere = false;
	private queue: Promise<unknown> = Promise.resolve();
	private readonly recordListeners = new Set<() => void>();
	private readonly updateListeners = new Set<UpdateHandler>();

	/** Which document this is; scopes the automatic backup to this store's own file. */
	protected abstract readonly kind: DocKind;
	protected readonly dbName: string;
	private readonly recordsKey: string;

	/**
	 * @param dbName Name of the IndexedDB database holding the document.
	 * @param recordsKey Name of the top-level `Y.Map` holding the records.
	 */
	protected constructor(dbName: string, recordsKey: string) {
		this.dbName = dbName;
		this.recordsKey = recordsKey;
		this._doc = new Y.Doc();
		this._records = this._doc.getMap<R>(recordsKey);
	}

	get doc(): Y.Doc {
		return this._doc;
	}

	protected get records(): Y.Map<R> {
		return this._records;
	}

	/** Whether the database existed before this store first opened it (memoized, so opening can't change the answer). */
	private existed(): Promise<boolean> {
		return (this.existedBeforeOpen ??= databaseExists(this.dbName));
	}

	/** Opens the database if needed and resolves once its state is loaded into the document. */
	protected async ready(): Promise<void> {
		this.opening ??= (async () => {
			await this.existed();
			this.persistence = new IndexeddbPersistence(this.dbName, this.doc);
			await this.persistence.whenSynced;
			// Opening creates the database, so from here on the store exists, whatever
			// `existed()` found before (it is memoized and would stay false).
			this.initializedHere = true;
		})();
		await this.opening;
	}

	/**
	 * Resolves once every change made so far is committed to IndexedDB. y-indexeddb
	 * writes updates in the background and doesn't report when they are done, so a
	 * caller that must not lose a write (a restore, a save followed by navigation)
	 * awaits this. A read transaction on the updates store is queued behind the
	 * pending write transactions, so it completes only after they have.
	 */
	protected async flush(): Promise<void> {
		const db = this.persistence?.db;
		if (!db) return;
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('updates', 'readonly');
			tx.objectStore('updates').count();
			tx.oncomplete = () => resolve();
			tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB flush aborted'));
		});
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

	/** The full document state as a Yjs update, for backup or relay to other devices. */
	async exportState(): Promise<Uint8Array> {
		await this.ready();
		return Y.encodeStateAsUpdate(this.doc);
	}

	/**
	 * Merge a Yjs update (e.g. another device's exported state) into the document.
	 * Idempotent. Returns what the merge changed, for a one-off report; nothing
	 * is kept, so a later call can't tell what an earlier one did.
	 */
	async importState(
		update: Uint8Array,
		{ backup = true }: { backup?: boolean } = {}
	): Promise<RecordChange<R>[]> {
		await this.ready();
		return this.serial(async () => {
			const local = readMeta(this._doc);
			const remote = readUpdateMeta(update);
			// The sender reset its document after ours: this device's document is from a retired generation.
			if (remote.resetId > local.resetId) return this.adopt(update, remote);
			// Operations from before our own reset would bring back what was deleted; ignore them.
			if (hasRetiredOps(update, local.retired)) return [];
			return this.merge(update, backup);
		});
	}

	/**
	 * @param backup Re-upload this device's file after a merge. Peers relay what they merge;
	 *   a central store (S3) already holds the merged records, so it passes `false`.
	 */
	private async merge(update: Uint8Array, backup: boolean): Promise<RecordChange<R>[]> {
		let changed = false;
		const onUpdate = () => {
			changed = true;
		};
		const changes: RecordChange<R>[] = [];
		const onRecords = (event: Y.YMapEvent<R>) => {
			for (const [id, change] of event.changes.keys) {
				const before = change.oldValue as R | undefined;
				const after = this.records.get(id);
				// A record rewritten with identical content isn't a change worth reporting.
				if (change.action === 'update' && JSON.stringify(before) === JSON.stringify(after))
					continue;
				changes.push({ id, action: change.action, before, after });
			}
		};
		this.doc.on('update', onUpdate);
		this.records.observe(onRecords);
		try {
			Y.applyUpdate(this.doc, update, REMOTE_ORIGIN);
		} finally {
			this.doc.off('update', onUpdate);
			this.records.unobserve(onRecords);
		}
		// Merged records reach other devices through this device's own file too,
		// but a no-op merge leaves nothing new to upload.
		if (changed) {
			if (backup) scheduleBackup(this.kind);
			await this.flush();
		}
		return changes;
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

	/** The updates a peer is missing, given its full state, without merging that state in. */
	async diffOnly(remoteState: Uint8Array): Promise<Uint8Array> {
		await this.ready();
		return Y.encodeStateAsUpdate(this.doc, Y.encodeStateVectorFromUpdate(remoteState));
	}

	/**
	 * Calls `callback` whenever the set of records changes, whatever the
	 * cause (local edit, merge from another device, clear). Returns the unsubscribe function.
	 */
	subscribe(callback: () => void): () => void {
		// The map exists from construction, so this works before the database is open;
		// the initial load from IndexedDB is reported as a change too.
		this.recordListeners.add(callback);
		this._records.observe(callback);
		return () => {
			this.recordListeners.delete(callback);
			this._records.unobserve(callback);
		};
	}

	/**
	 * Calls `handler` for every update to the document, with its transaction origin
	 * (none for a local edit). Unlike `doc.on('update')`, it keeps working after a reset.
	 * Returns the unsubscribe function.
	 */
	onUpdate(handler: UpdateHandler): () => void {
		this.updateListeners.add(handler);
		this._doc.on('update', handler);
		return () => {
			this.updateListeners.delete(handler);
			this._doc.off('update', handler);
		};
	}

	/** Runs `task` after every earlier one has finished, so documents are never swapped under a merge. */
	private serial<T>(task: () => Promise<T>): Promise<T> {
		const run = this.queue.then(task);
		this.queue = run.catch(() => undefined);
		return run;
	}

	/**
	 * Throws away the document and its history, including every tombstone, and starts a
	 * fresh one that carries a reset marker. Only allowed while no records are left, so
	 * nothing is lost here; delete them first.
	 *
	 * Other devices recognise the marker when they next merge this document: they replace
	 * their own document with it, and refuse any later update that still carries operations
	 * from before the reset, so deleted records can't come back. Records such a device
	 * created that this one never saw are kept (see `adopt()`).
	 */
	async reset(): Promise<void> {
		await this.ready();
		await this.serial(async () => {
			if (this._records.size > 0) {
				throw new Error('Delete all records before resetting');
			}
			const meta = readMeta(this._doc);
			const retired = toVector(meta.retired);
			for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(this._doc))) {
				retired.set(client, Math.max(retired.get(client) ?? 0, clock));
			}
			const next = new Y.Doc();
			await this.replaceDoc(next, () => {
				next.transact(() => {
					const nextMeta = next.getMap<unknown>(META_KEY);
					nextMeta.set('resetId', ulid());
					nextMeta.set('retired', Object.fromEntries(retired));
				});
			});
			scheduleBackup(this.kind);
		});
	}

	/**
	 * Replaces this device's document with `update`, the state of a document that was reset
	 * on another device. Records created here that the resetting device had not seen when
	 * it reset (they lie beyond `remote.retired`) are carried over to the new document and
	 * the user is told; everything else is dropped, as it was already archived.
	 */
	private async adopt(update: Uint8Array, remote: ResetMeta): Promise<RecordChange<R>[]> {
		const before = new Map(this._records.entries());
		const unseen = this.recordsBeyond(toVector(remote.retired), before);
		const next = new Y.Doc();
		await this.replaceDoc(next, () => {
			Y.applyUpdate(next, update, REMOTE_ORIGIN);
			if (unseen.size > 0) {
				next.transact(() => {
					const nextRecords = next.getMap<R>(this.recordsKey);
					for (const [id, record] of unseen) nextRecords.set(id, record);
				});
			}
		});
		if (unseen.size > 0) {
			notifier.warning(
				`The working set was reset on another device. ${unseen.size} record(s) on this device that it had not seen were kept.`
			);
		}
		scheduleBackup(this.kind);

		const changes: RecordChange<R>[] = [];
		for (const [id, after] of this._records) {
			const old = before.get(id);
			if (!old) changes.push({ id, action: 'add', after });
			else if (JSON.stringify(old) !== JSON.stringify(after))
				changes.push({ id, action: 'update', before: old, after });
		}
		for (const [id, old] of before) {
			if (!this._records.has(id)) changes.push({ id, action: 'delete', before: old });
		}
		return changes;
	}

	/** The live records in `live` whose creating operation lies beyond the state vector `seen`. */
	private recordsBeyond(seen: Map<number, number>, live: Map<string, R>): Map<string, R> {
		const scratch = new Y.Doc();
		try {
			// Only the operations beyond `seen` are in the update. A record that was merely edited
			// refers to an operation outside it, so it can't be integrated and stays out.
			Y.applyUpdate(scratch, Y.encodeStateAsUpdate(this._doc, Y.encodeStateVector(seen)));
			const beyond = scratch.getMap<R>(this.recordsKey);
			return new Map([...beyond.entries()].filter(([id]) => live.has(id)));
		} finally {
			scratch.destroy();
		}
	}

	/**
	 * Swaps in `next` as the document: deletes the persisted database, attaches `next` to a
	 * new one, moves subscribers over, and runs `populate`. Resolves once it is all committed.
	 */
	private async replaceDoc(next: Y.Doc, populate: () => void): Promise<void> {
		const previous = this._doc;
		await this.persistence?.clearData();
		this.persistence = new IndexeddbPersistence(this.dbName, next);
		await this.persistence.whenSynced;

		for (const callback of this.recordListeners) this._records.unobserve(callback);
		for (const handler of this.updateListeners) previous.off('update', handler);
		this._doc = next;
		this._records = next.getMap<R>(this.recordsKey);
		for (const callback of this.recordListeners) this._records.observe(callback);
		for (const handler of this.updateListeners) next.on('update', handler);
		previous.destroy();

		populate();
		await this.flush();
		// Subscribers watch the new map from here on, so tell them about the swap itself.
		for (const callback of this.recordListeners) callback();
	}

	async clear(): Promise<void> {
		await this.ready();
		this.doc.transact(() => this.records.clear());
		scheduleBackup(this.kind);
		await this.flush();
	}
}
