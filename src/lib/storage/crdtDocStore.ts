import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { scheduleBackup } from '$lib/services/webdavAutoBackupService';

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
	readonly doc: Y.Doc;
	protected readonly records: Y.Map<R>;
	private opening?: Promise<void>;
	private persistence?: IndexeddbPersistence;
	private existedBeforeOpen?: Promise<boolean>;
	private initializedHere = false;

	protected readonly dbName: string;

	/**
	 * @param dbName Name of the IndexedDB database holding the document.
	 * @param recordsKey Name of the top-level `Y.Map` holding the records.
	 */
	protected constructor(dbName: string, recordsKey: string) {
		this.dbName = dbName;
		this.doc = new Y.Doc();
		this.records = this.doc.getMap<R>(recordsKey);
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
	async importState(update: Uint8Array): Promise<RecordChange<R>[]> {
		await this.ready();
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
			scheduleBackup();
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

	/**
	 * Calls `callback` whenever the set of records changes, whatever the
	 * cause (local edit, merge from another device, clear). Returns the unsubscribe function.
	 */
	subscribe(callback: () => void): () => void {
		// The map exists from construction, so this works before the database is open;
		// the initial load from IndexedDB is reported as a change too.
		this.records.observe(callback);
		return () => this.records.unobserve(callback);
	}

	async clear(): Promise<void> {
		await this.ready();
		this.doc.transact(() => this.records.clear());
		scheduleBackup();
		await this.flush();
	}
}
