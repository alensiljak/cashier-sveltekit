/**
 * Delta sync of a CRDT store through a remote object store (S3, WebDAV). See
 * doc/projects/2026-10-16_delta-sync.md.
 *
 * Bucket layout, per store kind:
 * - `crdt/<kind>/snap-<ulid>.ydoc`        full state plus what it covers: the last delta of each device
 * - `crdt/<kind>/<deviceId>.<seq>.upd`    changes of one device, numbered without gaps
 *
 * The names are flat (no folder per device), so any store that lists a folder can hold them.
 *
 * A device writes only its own deltas and never overwrites an object. Updates are idempotent and
 * commutative, so applying one twice or out of order is harmless.
 */
import * as Y from 'yjs';
import { ulid } from 'ulid';
import { BUCKET_ORIGIN, REMOTE_ORIGIN, type ReplaceReason } from '#lib/storage/crdtDocStore';
import type { DocKind } from '#lib/sync/ydocDevices';
import type { RemoteStore } from './remoteStore';

/** Yjs state vector as JSON: client id -> clock. */
export type StateVectorJson = Record<string, number>;

/** What this device remembers between syncs; one per store kind. */
export interface DeltaState {
	/** Number for this device's next delta. */
	nextSeq: number;
	/** Newest snapshot applied here. */
	snapId: string | null;
	/** Last delta of each device that was applied here (or is covered by the applied snapshot). */
	applied: Record<string, number>;
	/** What the bucket is known to hold: its snapshot and every delta applied or uploaded here. */
	bucketSV: StateVectorJson;
	/** Changes not yet uploaded, as one Yjs update in base64. */
	outbox: string | null;
	/** Legacy per-device state files already merged: device -> `size|modified` at that time. */
	legacy?: Record<string, string>;
	/** The acknowledgement last published (JSON), to publish only when it changed. */
	acked?: string;
	/** This device reset its document: the bucket still needs the new generation's snapshot. */
	pendingSnapshot?: boolean;
}

/** What this device tells the others it has applied, so they can compact. Own deltas not included. */
export interface DeltaAck {
	snapId: string | null;
	applied: Record<string, number>;
}

/** Compact when this many delta objects have piled up, or the newest snapshot is this old. */
export const COMPACT_MIN_DELTAS = 30;
export const COMPACT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
/** A device whose acknowledgement is older than this no longer holds back clean-up. */
export const ACK_ACTIVE_WINDOW_MS = 30 * 24 * 3600 * 1000;

export interface DeltaStateStorage {
	load(): Promise<DeltaState | null>;
	save(state: DeltaState): Promise<void>;
}

/** The part of a CRDT store that delta sync needs (see `CrdtDocStore`). */
export interface DeltaDoc {
	stateVector(): Promise<Uint8Array>;
	exportState(): Promise<Uint8Array>;
	exportDelta(since: Map<number, number>): Promise<Uint8Array>;
	/** Called when the document is replaced by a new generation (reset, or adopting another's). */
	onReplaced?(handler: (reason: ReplaceReason) => void): () => void;
	importState(
		update: Uint8Array,
		opts: { backup?: boolean; origin?: unknown }
	): Promise<readonly unknown[]>;
	onUpdate(handler: (update: Uint8Array, origin: unknown) => void): () => void;
}

// --- object keys and formats ---

const pad = (seq: number) => String(seq).padStart(6, '0');

export const kindPrefix = (kind: DocKind) => `crdt/${kind}/`;
export const snapshotKey = (kind: DocKind, id: string) => `${kindPrefix(kind)}snap-${id}.ydoc`;
/** Start of every object a device wrote: its deltas, and its legacy state file. */
export const deviceDeltaPrefix = (kind: DocKind, deviceId: string) =>
	`${kindPrefix(kind)}${deviceId}.`;
export const deltaKey = (kind: DocKind, deviceId: string, seq: number) =>
	`${deviceDeltaPrefix(kind, deviceId)}${pad(seq)}.upd`;
export const legacyKey = (kind: DocKind, deviceId: string) => `${kindPrefix(kind)}${deviceId}.ydoc`;

/** What a device has applied, for the others to read before they compact. Rewritten when it changes. */
export const ackKey = (kind: DocKind, deviceId: string) => `${kindPrefix(kind)}${deviceId}.ack`;

export type ParsedKey =
	| { type: 'snapshot'; id: string }
	| { type: 'delta'; deviceId: string; seq: number }
	| { type: 'ack'; deviceId: string }
	/** `crdt/<kind>/<deviceId>.ydoc`: the whole state of one device, as the app wrote it before delta sync. */
	| { type: 'legacy'; deviceId: string };

/** What an object under `crdt/<kind>/` is; null for anything else (strangers). */
export function parseKey(kind: DocKind, key: string): ParsedKey | null {
	const rest = key.startsWith(kindPrefix(kind)) ? key.slice(kindPrefix(kind).length) : null;
	if (rest === null) return null;
	const snap = /^snap-([0-9A-Za-z]+)\.ydoc$/.exec(rest);
	if (snap) return { type: 'snapshot', id: snap[1] };
	const delta = /^([^/.]+)\.(\d+)\.upd$/.exec(rest);
	if (delta) return { type: 'delta', deviceId: delta[1], seq: Number(delta[2]) };
	const ack = /^([^/.]+)\.ack$/.exec(rest);
	if (ack) return { type: 'ack', deviceId: ack[1] };
	const legacy = /^([^/.]+)\.ydoc$/.exec(rest);
	if (legacy) return { type: 'legacy', deviceId: legacy[1] };
	return null;
}

/** The device that wrote an object, or null for a snapshot (written by whichever device compacted). */
export function deviceOfKey(kind: DocKind, key: string): string | null {
	const parsed = parseKey(kind, key);
	return parsed && parsed.type !== 'snapshot' ? parsed.deviceId : null;
}

export interface SnapshotContent {
	/** Last delta of each device that the snapshot includes. */
	coverage: Record<string, number>;
	update: Uint8Array;
}

/** A snapshot object: 4-byte header length, the JSON header `{ coverage }`, then the Yjs update. */
export function encodeSnapshot({ coverage, update }: SnapshotContent): Uint8Array {
	const header = new TextEncoder().encode(JSON.stringify({ coverage }));
	const out = new Uint8Array(4 + header.length + update.length);
	new DataView(out.buffer).setUint32(0, header.length);
	out.set(header, 4);
	out.set(update, 4 + header.length);
	return out;
}

export function decodeSnapshot(bytes: Uint8Array): SnapshotContent {
	if (bytes.length < 4) throw new Error('Snapshot is too short');
	const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
	if (4 + headerLength > bytes.length) throw new Error('Snapshot header is truncated');
	const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)));
	const coverage: Record<string, number> = {};
	for (const [device, seq] of Object.entries(header?.coverage ?? {})) {
		if (typeof seq === 'number' && Number.isFinite(seq)) coverage[device] = seq;
	}
	return { coverage, update: bytes.subarray(4 + headerLength) };
}

// --- small helpers ---

const toBase64 = (bytes: Uint8Array): string => {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(s);
};

const fromBase64 = (text: string): Uint8Array =>
	Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/**
 * The clocks an update reaches, per client. Unlike `Y.encodeStateVectorFromUpdate`, which only
 * counts structs that start at clock 0, this works for a delta that begins later.
 */
export function vectorOf(update: Uint8Array): Map<number, number> {
	const reach = new Map<number, number>();
	for (const s of Y.decodeUpdate(update).structs) {
		if (s.constructor.name === 'Skip') continue;
		reach.set(s.id.client, Math.max(reach.get(s.id.client) ?? 0, s.id.clock + s.length));
	}
	return reach;
}

const toMap = (json: StateVectorJson): Map<number, number> =>
	new Map(Object.entries(json).map(([client, clock]) => [Number(client), clock]));

function raise(into: StateVectorJson, from: Map<number, number>): void {
	for (const [client, clock] of from) {
		into[client] = Math.max(into[client] ?? 0, clock);
	}
}

const emptyState = (): DeltaState => ({
	nextSeq: 1,
	snapId: null,
	applied: {},
	bucketSV: {},
	outbox: null
});

/** True when the object an adapter returned is missing, e.g. compacted since it was listed. */
class Vanished extends Error {}

/** An object in the bucket that belongs to this store. */
export interface BucketObject {
	key: string;
	type: ParsedKey['type'];
	/** Null for a snapshot. */
	deviceId: string | null;
	size: number;
	lastModified: Date | null;
}

export interface BucketUpdate {
	object: BucketObject;
	update: Uint8Array;
}

export interface DownloadResult {
	/** Objects in the bucket written by other devices (or snapshots). Zero: nobody has uploaded yet. */
	foreign: number;
	/** A newer snapshot was applied. */
	snapshot: boolean;
	/** Deltas applied. */
	deltas: number;
	/** Legacy per-device state files merged. */
	legacy: number;
	/** Records changed by what was applied. */
	changes: number;
	/** The changes themselves, as the store reported them. */
	records: unknown[];
	/** Devices whose deltas were not applied, with the reason (e.g. not trusted). */
	skipped: { deviceId: string; reason: string }[];
	/** Devices whose next delta is missing from the bucket; they are applied up to the gap only. */
	gaps: { deviceId: string; expected: number; found: number }[];
	errors: { key: string; message: string }[];
}

export interface CompactResult {
	/** Id of the snapshot written, or null when there was nothing to compact. */
	snapshot: string | null;
	deleted: number;
	/** Why nothing was done, when that is not simply "nothing to do". */
	skipped?: string;
}

/**
 * Whether it is time to compact, from a listing alone: enough deltas have piled up, or some have
 * waited longer than a week for a snapshot.
 */
export function needsCompaction(objects: BucketObject[], now = Date.now()): boolean {
	const deltas = objects.filter((o) => o.type === 'delta');
	if (!deltas.length) return false;
	if (deltas.length >= COMPACT_MIN_DELTAS) return true;
	const times = (type: BucketObject['type']) =>
		objects.filter((o) => o.type === type && o.lastModified).map((o) => o.lastModified!.getTime());
	const snapshots = times('snapshot');
	// Without a snapshot, the oldest delta is what has been waiting.
	const since = snapshots.length ? Math.max(...snapshots) : Math.min(...times('delta'));
	return Number.isFinite(since) && now - since > COMPACT_MAX_AGE_MS;
}

export interface DeltaSyncOptions {
	kind: DocKind;
	deviceId: string;
	doc: DeltaDoc;
	remote: RemoteStore;
	storage: DeltaStateStorage;
	/** Why a device's data is not applied here (not trusted, read-only), or null to apply it. */
	ignore?: (deviceId: string) => string | null;
}

const stampOf = (o: { size: number; lastModified: Date | null }) =>
	`${o.size}|${o.lastModified?.toISOString() ?? ''}`;

export class DeltaSync {
	private o: DeltaSyncOptions;
	private state: DeltaState = emptyState();
	/** Changes captured since the last upload, oldest first. */
	private pending: Uint8Array[] = [];
	private loaded?: Promise<void>;
	private detach?: () => void;
	private detachReplaced?: () => void;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(options: DeltaSyncOptions) {
		this.o = options;
	}

	/**
	 * Loads the saved state and starts capturing the document's changes for upload. Call it as
	 * soon as the store exists: changes made before are found later by `healOutbox`, at a cost.
	 */
	async attach(): Promise<void> {
		await this.load();
		if (this.detach) return;
		this.detach = this.o.doc.onUpdate((update, origin) => {
			// Local edits have no origin; a peer merge carries REMOTE_ORIGIN. The bucket's own
			// updates, and the load from IndexedDB, are not ours to upload.
			if (origin === BUCKET_ORIGIN) return;
			if (origin !== null && origin !== undefined && origin !== REMOTE_ORIGIN) return;
			this.pending.push(update);
			void this.serial(() => this.persist());
		});
		this.detachReplaced = this.o.doc.onReplaced?.((reason) => this.replaced(reason));
	}

	dispose(): void {
		this.detach?.();
		this.detach = undefined;
		this.detachReplaced?.();
		this.detachReplaced = undefined;
	}

	/**
	 * A new generation of the document: what was captured, and what we knew of the bucket, belongs
	 * to the old one. After our own reset the bucket also needs the new generation's snapshot,
	 * which the next upload writes.
	 */
	private replaced(reason: ReplaceReason): void {
		this.pending = [];
		this.state.bucketSV = {};
		if (reason === 'reset') this.state.pendingSnapshot = true;
		void this.serial(() => this.persist());
	}

	/** Replaces the transport or the ignore list, e.g. when the bucket settings or trust list changed. */
	configure(changes: Partial<Pick<DeltaSyncOptions, 'remote' | 'ignore'>>): void {
		this.o = { ...this.o, ...changes };
	}

	private load(): Promise<void> {
		this.loaded ??= (async () => {
			this.state = (await this.o.storage.load()) ?? emptyState();
			if (this.state.outbox) this.pending.unshift(fromBase64(this.state.outbox));
		})();
		return this.loaded;
	}

	private serial<T>(task: () => Promise<T>): Promise<T> {
		const run = this.queue.then(task);
		this.queue = run.catch(() => undefined);
		return run;
	}

	private async persist(): Promise<void> {
		this.state.outbox = this.pending.length ? toBase64(Y.mergeUpdates(this.pending)) : null;
		await this.o.storage.save(this.state);
	}

	/** The last delta of each device that this device holds, itself included. */
	async coverage(): Promise<Record<string, number>> {
		await this.load();
		return this.coverageNow();
	}

	private coverageNow(): Record<string, number> {
		return { ...this.state.applied, [this.o.deviceId]: this.state.nextSeq - 1 };
	}

	/**
	 * Tells the other devices what this device has applied, so they know which deltas they may
	 * delete. One small object per device and store, written only when that changed. Returns
	 * whether it wrote. This device's own uploads are not part of it, so frequent uploads leave
	 * it alone.
	 */
	async publishAck(): Promise<boolean> {
		await this.load();
		return this.serial(async () => {
			const applied = { ...this.state.applied };
			delete applied[this.o.deviceId];
			const ack: DeltaAck = { snapId: this.state.snapId, applied };
			const json = JSON.stringify(ack);
			if (json === this.state.acked) return false;
			await this.o.remote.put(ackKey(this.o.kind, this.o.deviceId), new TextEncoder().encode(json));
			this.state.acked = json;
			await this.persist();
			return true;
		});
	}

	/**
	 * What each active device has applied. A device is active when `isActive` says so (it is
	 * trusted) and its acknowledgement was written within `ACK_ACTIVE_WINDOW_MS`. A device without
	 * an acknowledgement (an old app version, or never synced) does not hold anything back, and one
	 * whose acknowledgement cannot be read holds everything back until it writes a new one.
	 */
	private async readAcks(
		objects: BucketObject[],
		isActive: (deviceId: string) => boolean,
		now: number
	): Promise<Record<string, Record<string, number>>> {
		const acks: Record<string, Record<string, number>> = {};
		for (const o of objects) {
			if (o.type !== 'ack' || !o.deviceId || o.deviceId === this.o.deviceId) continue;
			if (!isActive(o.deviceId)) continue;
			if (o.lastModified && now - o.lastModified.getTime() > ACK_ACTIVE_WINDOW_MS) continue;
			const raw = await this.o.remote.get(o.key);
			if (!raw) continue;
			try {
				const parsed = JSON.parse(new TextDecoder().decode(raw));
				acks[o.deviceId] = parsed && typeof parsed.applied === 'object' ? parsed.applied : {};
			} catch {
				acks[o.deviceId] = {};
			}
		}
		return acks;
	}

	/**
	 * Compacts when it is time (see `needsCompaction`), judging by the active devices'
	 * acknowledgements. Returns null when it is not time. Pass `force` to compact regardless.
	 */
	async compactIfDue(opts: {
		isActive: (deviceId: string) => boolean;
		force?: boolean;
		now?: number;
	}): Promise<CompactResult | null> {
		await this.load();
		const now = opts.now ?? Date.now();
		const objects = await this.objects();
		if (!opts.force && !needsCompaction(objects, now)) return null;
		return this.compact(await this.readAcks(objects, opts.isActive, now));
	}

	// --- upload ---

	/**
	 * Adds to the outbox what the document holds beyond what the bucket and the outbox cover:
	 * changes made before `attach`, or an outbox that was lost (IndexedDB cleared, a crash). It
	 * sends more than the changes themselves would (the whole delete set), but it is correct.
	 */
	private async healOutbox(): Promise<void> {
		const covered = toMap(this.state.bucketSV);
		if (this.pending.length) {
			const merged: StateVectorJson = {};
			raise(merged, covered);
			raise(merged, vectorOf(Y.mergeUpdates(this.pending)));
			for (const [client, clock] of Object.entries(merged)) covered.set(Number(client), clock);
		}
		const own = Y.decodeStateVector(await this.o.doc.stateVector());
		const ahead = [...own].some(([client, clock]) => clock > (covered.get(client) ?? 0));
		if (ahead) this.pending.push(await this.o.doc.exportDelta(covered));
	}

	/** Whether the document has changes the bucket lacks. Local only. */
	async hasUpload(): Promise<boolean> {
		await this.load();
		return this.serial(async () => {
			if (this.state.pendingSnapshot) return true;
			const before = this.pending.length;
			await this.healOutbox();
			const needed = this.pending.length > 0;
			// A dry run: drop what healing added.
			this.pending.length = before;
			return needed;
		});
	}

	/** Uploads the changes made since the last upload as one delta. `seq` is null when there are none. */
	async upload(): Promise<{ seq: number | null; bytes: number }> {
		await this.load();
		return this.serial(() => this.uploadLocked());
	}

	private async uploadLocked(): Promise<{ seq: number | null; bytes: number }> {
		if (this.state.pendingSnapshot) await this.publishReset();
		await this.healOutbox();
		if (!this.pending.length) return { seq: null, bytes: 0 };

		const sent = Y.mergeUpdates(this.pending);
		const held = this.pending;
		this.pending = [];
		try {
			const { kind, deviceId, remote } = this.o;
			// The counter is local state; the bucket is the truth when that was lost.
			let seq = this.state.nextSeq;
			for (const info of await remote.list(deviceDeltaPrefix(kind, deviceId))) {
				const parsed = parseKey(kind, info.key);
				if (parsed?.type === 'delta' && parsed.deviceId === deviceId) {
					seq = Math.max(seq, parsed.seq + 1);
				}
			}
			// An object under this number already holds something else: take the next number.
			for (let attempt = 0; ; attempt++) {
				if (await remote.put(deltaKey(kind, deviceId, seq), sent, { onlyIfAbsent: true })) break;
				if (attempt >= 10) throw new Error(`Could not claim a delta number near ${seq}`);
				seq++;
			}
			this.state.nextSeq = seq + 1;
			raise(this.state.bucketSV, vectorOf(sent));
			await this.persist();
			return { seq, bytes: sent.length };
		} catch (e) {
			// Nothing was stored, or we cannot tell: keep the changes for the next try.
			this.pending = [...held, ...this.pending];
			await this.persist();
			throw e;
		}
	}

	// --- snapshots and compaction ---

	/**
	 * Writes the whole document as a new snapshot that covers `coverage`. Everything captured so
	 * far is in it, so the outbox is emptied (and restored if the write fails).
	 */
	private async writeSnapshot(coverage: Record<string, number>): Promise<string> {
		const { kind, doc, remote } = this.o;
		const held = this.pending;
		this.pending = [];
		try {
			const update = await doc.exportState();
			const body = encodeSnapshot({ coverage, update });
			let id = ulid();
			for (
				let attempt = 0;
				!(await remote.put(snapshotKey(kind, id), body, { onlyIfAbsent: true }));
			) {
				if (++attempt >= 5) throw new Error('Could not name the snapshot');
				id = ulid();
			}
			this.state.snapId = id;
			raise(this.state.bucketSV, vectorOf(update));
			await this.persist();
			return id;
		} catch (e) {
			this.pending = [...held, ...this.pending];
			throw e;
		}
	}

	/**
	 * After this device reset its document: publishes the new generation as a snapshot, and removes
	 * what belongs to the old one, which is this device's deltas and the older snapshots. Other
	 * devices' deltas stay: they are applied or refused as retired when read, like any other.
	 */
	private async publishReset(): Promise<void> {
		const { kind, deviceId, remote } = this.o;
		const id = await this.writeSnapshot(this.coverageNow());
		for (const o of await this.objects()) {
			const parsed = parseKey(kind, o.key);
			const older = parsed?.type === 'snapshot' && parsed.id < id;
			if (o.deviceId === deviceId || older) await remote.delete(o.key);
		}
		this.state.pendingSnapshot = false;
		await this.persist();
	}

	/**
	 * Folds what has piled up into a snapshot and deletes what it makes unnecessary: the deltas
	 * that every device in `acks` has applied, this device's legacy state file, and all but the
	 * newest two snapshots. `acks` maps each active device to what it has applied (`DeltaAck.applied`).
	 *
	 * Deleting is never a risk to data: a snapshot holds everything it covers, so a device that
	 * has not applied a deleted delta takes the snapshot. The acknowledgements only keep that from
	 * happening to devices that sync regularly.
	 */
	async compact(acks: Record<string, Record<string, number>>): Promise<CompactResult> {
		await this.load();
		return this.serial(async () => {
			const { kind, deviceId, remote } = this.o;
			const down = await this.downloadRetry();
			if (down.errors.length || down.gaps.length) {
				return {
					snapshot: null,
					deleted: 0,
					skipped: 'Not everything in the bucket could be merged'
				};
			}
			await this.uploadLocked();

			const coverage = this.coverageNow();
			const objects = await this.objects();
			const deletable = objects.filter((o) => {
				const parsed = parseKey(kind, o.key);
				if (parsed?.type === 'delta') {
					if (parsed.seq > (coverage[parsed.deviceId] ?? 0)) return false;
					return Object.entries(acks).every(
						([device, applied]) =>
							device === parsed.deviceId || (applied[parsed.deviceId] ?? 0) >= parsed.seq
					);
				}
				return parsed?.type === 'legacy' && parsed.deviceId === deviceId;
			});
			if (!deletable.length) return { snapshot: null, deleted: 0 };

			const snapshot = await this.writeSnapshot(coverage);
			for (const o of deletable) await remote.delete(o.key);
			const snapshots = (await this.objects())
				.filter((o) => o.type === 'snapshot')
				.sort((a, b) => b.key.localeCompare(a.key));
			for (const o of snapshots.slice(2)) await remote.delete(o.key);
			return { snapshot, deleted: deletable.length + Math.max(0, snapshots.length - 2) };
		});
	}

	/**
	 * Removes everything a device wrote from the bucket. First merges what it wrote (it must still
	 * be trusted) and publishes it in a snapshot, so nobody loses a change that only its deltas held.
	 */
	async forget(device: string): Promise<{ deleted: number }> {
		await this.load();
		return this.serial(async () => {
			const down = await this.downloadRetry();
			if (down.errors.length) {
				throw new Error(`Could not merge everything first: ${down.errors[0].message}`);
			}
			await this.uploadLocked();
			await this.writeSnapshot(this.coverageNow());

			let deleted = 0;
			for (const o of await this.objects()) {
				if (o.deviceId !== device) continue;
				await this.o.remote.delete(o.key);
				deleted++;
			}
			delete this.state.applied[device];
			delete this.state.legacy?.[device];
			await this.persist();
			return { deleted };
		});
	}

	// --- download ---

	/**
	 * Applies the newest snapshot, if this device has not, and every delta of the other devices
	 * beyond what was applied. Safe to repeat. Imports with `BUCKET_ORIGIN` and without a backup
	 * upload, so what was just downloaded is not sent back.
	 */
	async download(): Promise<DownloadResult> {
		await this.load();
		return this.serial(() => this.downloadRetry());
	}

	private async downloadRetry(): Promise<DownloadResult> {
		// A listed object can be compacted away before it is read; the listing is then stale.
		for (let attempt = 0; ; attempt++) {
			try {
				return await this.downloadOnce();
			} catch (e) {
				if (!(e instanceof Vanished) || attempt >= 3) throw e;
			}
		}
	}

	private async downloadOnce(): Promise<DownloadResult> {
		const { kind, deviceId, doc, remote } = this.o;
		const result: DownloadResult = {
			foreign: 0,
			snapshot: false,
			deltas: 0,
			legacy: 0,
			changes: 0,
			records: [],
			skipped: [],
			gaps: [],
			errors: []
		};

		const objects = await this.objects();
		const { snapshotId, deltas, legacy } = this.scan(objects);
		const state = this.state;
		result.foreign = objects.filter((o) => o.type !== 'ack' && o.deviceId !== deviceId).length;

		if (snapshotId && (!state.snapId || snapshotId > state.snapId)) {
			const key = snapshotKey(kind, snapshotId);
			const raw = await remote.get(key);
			if (!raw) throw new Vanished(key);
			try {
				const { coverage, update } = decodeSnapshot(raw);
				await applyTo(result, await doc.importState(update, importOpts));
				state.snapId = snapshotId;
				for (const [device, seq] of Object.entries(coverage)) {
					state.applied[device] = Math.max(state.applied[device] ?? 0, seq);
				}
				raise(state.bucketSV, vectorOf(update));
				result.snapshot = true;
			} catch (e) {
				if (e instanceof Vanished) throw e;
				result.errors.push({ key, message: errorText(e) });
				// Deltas that follow a snapshot we could not apply would not make sense: stop here.
				await this.persist();
				return result;
			}
		}

		for (const [device, seqs] of deltas) {
			if (device === deviceId) continue;
			const reason = this.o.ignore?.(device);
			if (reason) {
				result.skipped.push({ deviceId: device, reason });
				continue;
			}
			for (const seq of seqs) {
				const done = state.applied[device] ?? 0;
				if (seq <= done) continue;
				if (seq !== done + 1) {
					result.gaps.push({ deviceId: device, expected: done + 1, found: seq });
					break;
				}
				const key = deltaKey(kind, device, seq);
				const raw = await remote.get(key);
				if (!raw) throw new Vanished(key);
				try {
					await applyTo(result, await doc.importState(raw, importOpts));
				} catch (e) {
					result.errors.push({ key, message: errorText(e) });
					break;
				}
				state.applied[device] = seq;
				raise(state.bucketSV, vectorOf(raw));
				result.deltas++;
			}
		}

		// State files of devices that have not been updated to delta sync: merged again whenever
		// the file changed.
		const stamps = (state.legacy ??= {});
		for (const file of legacy) {
			const device = file.deviceId!;
			if (device === deviceId) continue;
			const reason = this.o.ignore?.(device);
			if (reason) {
				if (!result.skipped.some((s) => s.deviceId === device)) {
					result.skipped.push({ deviceId: device, reason });
				}
				continue;
			}
			if (stamps[device] === stampOf(file)) continue;
			const raw = await remote.get(file.key);
			if (!raw) throw new Vanished(file.key);
			try {
				await applyTo(result, await doc.importState(raw, importOpts));
			} catch (e) {
				result.errors.push({ key: file.key, message: errorText(e) });
				continue;
			}
			stamps[device] = stampOf(file);
			raise(state.bucketSV, vectorOf(raw));
			result.legacy++;
		}

		await this.persist();
		return result;
	}

	/** The newest snapshot id, each device's delta numbers in ascending order, and the legacy files. */
	private scan(objects: BucketObject[]): {
		snapshotId: string | null;
		deltas: Map<string, number[]>;
		legacy: BucketObject[];
	} {
		let snapshotId: string | null = null;
		const deltas = new Map<string, number[]>();
		const legacy: BucketObject[] = [];
		for (const o of objects) {
			const parsed = parseKey(this.o.kind, o.key);
			if (parsed?.type === 'snapshot') {
				if (!snapshotId || parsed.id > snapshotId) snapshotId = parsed.id;
			} else if (parsed?.type === 'delta') {
				const seqs = deltas.get(parsed.deviceId) ?? [];
				seqs.push(parsed.seq);
				deltas.set(parsed.deviceId, seqs);
			} else if (parsed?.type === 'legacy') {
				legacy.push(o);
			}
		}
		for (const seqs of deltas.values()) seqs.sort((a, b) => a - b);
		return { snapshotId, deltas, legacy };
	}

	/** What the bucket holds for this store: one listing, nothing fetched or decrypted. */
	async objects(): Promise<BucketObject[]> {
		const { kind, remote } = this.o;
		const objects: BucketObject[] = [];
		for (const info of await remote.list(kindPrefix(kind))) {
			const parsed = parseKey(kind, info.key);
			if (!parsed) continue;
			objects.push({
				key: info.key,
				type: parsed.type,
				deviceId: parsed.type === 'snapshot' ? null : parsed.deviceId,
				size: info.size,
				lastModified: info.lastModified
			});
		}
		return objects;
	}

	/**
	 * Fetches objects without applying them, for previews and diagnostics. Objects of ignored
	 * devices are left out. With `unappliedOnly`, only what a download would apply, in that order:
	 * a newer snapshot, other devices' deltas beyond the applied ones (up to a gap), changed
	 * legacy files. Without it, everything the bucket holds.
	 */
	async read({
		unappliedOnly,
		includeIgnored = false
	}: {
		unappliedOnly: boolean;
		/** Also fetch the objects of devices on the ignore list. */
		includeIgnored?: boolean;
	}): Promise<BucketUpdate[]> {
		await this.load();
		const { deviceId, remote } = this.o;
		const objects = (await this.objects()).filter((o) => o.type !== 'ack');
		const { snapshotId } = this.scan(objects);
		const wanted: BucketObject[] = [];
		const nextExpected = new Map<string, number>();
		// Snapshots first, then legacy files, then each device's deltas in order: they build on them.
		const order = { snapshot: 0, legacy: 1, delta: 2, ack: 3 } as const;
		const seqOf = (o: BucketObject) => {
			const p = parseKey(this.o.kind, o.key);
			return p?.type === 'delta' ? p.seq : 0;
		};
		const sorted = objects.sort(
			(a, b) => order[a.type] - order[b.type] || a.key.localeCompare(b.key) || seqOf(a) - seqOf(b)
		);

		for (const o of sorted) {
			if (!includeIgnored && o.deviceId && o.deviceId !== deviceId && this.o.ignore?.(o.deviceId)) {
				continue;
			}
			if (!unappliedOnly) {
				wanted.push(o);
				continue;
			}
			const parsed = parseKey(this.o.kind, o.key)!;
			if (parsed.type === 'snapshot') {
				if (parsed.id === snapshotId && (!this.state.snapId || parsed.id > this.state.snapId)) {
					wanted.push(o);
				}
			} else if (parsed.type === 'legacy') {
				if (parsed.deviceId !== deviceId && this.state.legacy?.[parsed.deviceId] !== stampOf(o)) {
					wanted.push(o);
				}
			} else if (parsed.type === 'delta' && parsed.deviceId !== deviceId) {
				const done = this.state.applied[parsed.deviceId] ?? 0;
				const expected = nextExpected.get(parsed.deviceId) ?? done + 1;
				if (parsed.seq < expected) continue;
				if (parsed.seq === expected) {
					wanted.push(o);
					nextExpected.set(parsed.deviceId, expected + 1);
				}
			}
		}

		const updates: BucketUpdate[] = [];
		for (const object of wanted) {
			const raw = await remote.get(object.key);
			if (!raw) continue;
			updates.push({
				object,
				update: object.type === 'snapshot' ? decodeSnapshot(raw).update : raw
			});
		}
		return updates;
	}

	// --- status ---

	/**
	 * Compares this device with the bucket from one listing, without fetching or decrypting
	 * anything: `download` = a newer snapshot or deltas not applied here; `upload` = changes the
	 * bucket lacks.
	 */
	async status(): Promise<{ upload: boolean; download: boolean }> {
		await this.load();
		const { snapshotId, deltas, legacy } = this.scan(await this.objects());
		let download = !!snapshotId && (!this.state.snapId || snapshotId > this.state.snapId);
		for (const [device, seqs] of deltas) {
			if (device === this.o.deviceId || this.o.ignore?.(device)) continue;
			if (seqs.some((seq) => seq > (this.state.applied[device] ?? 0))) download = true;
		}
		for (const file of legacy) {
			const device = file.deviceId!;
			if (device === this.o.deviceId || this.o.ignore?.(device)) continue;
			if (this.state.legacy?.[device] !== stampOf(file)) download = true;
		}
		return { upload: await this.hasUpload(), download };
	}
}

const importOpts = { backup: false, origin: BUCKET_ORIGIN };

/** Adds what an import changed to the result. */
async function applyTo(result: DownloadResult, changes: readonly unknown[]): Promise<void> {
	result.changes += changes.length;
	result.records.push(...changes);
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
