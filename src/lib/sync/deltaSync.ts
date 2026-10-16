/**
 * Delta sync of a CRDT store through a remote object store (S3, WebDAV). See
 * doc/projects/2026-10-16_delta-sync.md.
 *
 * Bucket layout, per store kind:
 * - `crdt/<kind>/snap-<ulid>.ydoc`        full state plus what it covers: the last delta of each device
 * - `crdt/<kind>/<deviceId>/d-<seq>.upd`  changes of one device, numbered without gaps
 *
 * A device writes only its own deltas and never overwrites an object. Updates are idempotent and
 * commutative, so applying one twice or out of order is harmless.
 */
import * as Y from 'yjs';
import { BUCKET_ORIGIN, REMOTE_ORIGIN } from '#lib/storage/crdtDocStore';
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
}

export interface DeltaStateStorage {
	load(): Promise<DeltaState | null>;
	save(state: DeltaState): Promise<void>;
}

/** The part of a CRDT store that delta sync needs (see `CrdtDocStore`). */
export interface DeltaDoc {
	stateVector(): Promise<Uint8Array>;
	exportDelta(since: Map<number, number>): Promise<Uint8Array>;
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
export const deviceDeltaPrefix = (kind: DocKind, deviceId: string) =>
	`${kindPrefix(kind)}${deviceId}/`;
export const deltaKey = (kind: DocKind, deviceId: string, seq: number) =>
	`${deviceDeltaPrefix(kind, deviceId)}d-${pad(seq)}.upd`;

export type ParsedKey =
	| { type: 'snapshot'; id: string }
	| { type: 'delta'; deviceId: string; seq: number };

/** What an object under `crdt/<kind>/` is; null for anything else (legacy files, strangers). */
export function parseKey(kind: DocKind, key: string): ParsedKey | null {
	const rest = key.startsWith(kindPrefix(kind)) ? key.slice(kindPrefix(kind).length) : null;
	if (rest === null) return null;
	const snap = /^snap-([0-9A-Za-z]+)\.ydoc$/.exec(rest);
	if (snap) return { type: 'snapshot', id: snap[1] };
	const delta = /^([^/]+)\/d-(\d+)\.upd$/.exec(rest);
	if (delta) return { type: 'delta', deviceId: delta[1], seq: Number(delta[2]) };
	return null;
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
function vectorOf(update: Uint8Array): Map<number, number> {
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

export interface DownloadResult {
	/** A newer snapshot was applied. */
	snapshot: boolean;
	/** Deltas applied. */
	deltas: number;
	/** Records changed by what was applied. */
	changes: number;
	/** Devices whose deltas were not applied, with the reason (e.g. not trusted). */
	skipped: { deviceId: string; reason: string }[];
	/** Devices whose next delta is missing from the bucket; they are applied up to the gap only. */
	gaps: { deviceId: string; expected: number; found: number }[];
	errors: { key: string; message: string }[];
}

export interface DeltaSyncOptions {
	kind: DocKind;
	deviceId: string;
	doc: DeltaDoc;
	remote: RemoteStore;
	storage: DeltaStateStorage;
	/** Why a device's deltas are not applied here (not trusted, read-only), or null to apply them. */
	ignore?: (deviceId: string) => string | null;
}

export class DeltaSync {
	private readonly o: DeltaSyncOptions;
	private state: DeltaState = emptyState();
	/** Changes captured since the last upload, oldest first. */
	private pending: Uint8Array[] = [];
	private loaded?: Promise<void>;
	private detach?: () => void;
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
	}

	dispose(): void {
		this.detach?.();
		this.detach = undefined;
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

	/** The last delta of each device that this device holds, itself included. For acknowledgements. */
	async coverage(): Promise<Record<string, number>> {
		await this.load();
		return { ...this.state.applied, [this.o.deviceId]: this.state.nextSeq - 1 };
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
		return this.serial(async () => {
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
		return this.serial(async () => {
			// A listed object can be compacted away before it is read; the listing is then stale.
			for (let attempt = 0; ; attempt++) {
				try {
					return await this.downloadOnce();
				} catch (e) {
					if (!(e instanceof Vanished) || attempt >= 3) throw e;
				}
			}
		});
	}

	private async downloadOnce(): Promise<DownloadResult> {
		const { kind, deviceId, doc, remote } = this.o;
		const result: DownloadResult = {
			snapshot: false,
			deltas: 0,
			changes: 0,
			skipped: [],
			gaps: [],
			errors: []
		};

		const { snapshotId, deltas } = this.scan(await remote.list(kindPrefix(kind)));
		const state = this.state;

		if (snapshotId && (!state.snapId || snapshotId > state.snapId)) {
			const key = snapshotKey(kind, snapshotId);
			const raw = await remote.get(key);
			if (!raw) throw new Vanished(key);
			try {
				const { coverage, update } = decodeSnapshot(raw);
				result.changes += (await doc.importState(update, importOpts)).length;
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
					result.changes += (await doc.importState(raw, importOpts)).length;
				} catch (e) {
					result.errors.push({ key, message: errorText(e) });
					break;
				}
				state.applied[device] = seq;
				raise(state.bucketSV, vectorOf(raw));
				result.deltas++;
			}
		}

		await this.persist();
		return result;
	}

	/** Newest snapshot id, and each device's delta numbers in ascending order. */
	private scan(infos: { key: string }[]): {
		snapshotId: string | null;
		deltas: Map<string, number[]>;
	} {
		let snapshotId: string | null = null;
		const deltas = new Map<string, number[]>();
		for (const { key } of infos) {
			const parsed = parseKey(this.o.kind, key);
			if (parsed?.type === 'snapshot') {
				if (!snapshotId || parsed.id > snapshotId) snapshotId = parsed.id;
			} else if (parsed?.type === 'delta') {
				const seqs = deltas.get(parsed.deviceId) ?? [];
				seqs.push(parsed.seq);
				deltas.set(parsed.deviceId, seqs);
			}
		}
		for (const seqs of deltas.values()) seqs.sort((a, b) => a - b);
		return { snapshotId, deltas };
	}

	// --- status ---

	/**
	 * Compares this device with the bucket from one listing, without fetching or decrypting
	 * anything: `download` = a newer snapshot or deltas not applied here; `upload` = changes the
	 * bucket lacks.
	 */
	async status(): Promise<{ upload: boolean; download: boolean }> {
		await this.load();
		const { snapshotId, deltas } = this.scan(await this.o.remote.list(kindPrefix(this.o.kind)));
		let download = !!snapshotId && (!this.state.snapId || snapshotId > this.state.snapId);
		for (const [device, seqs] of deltas) {
			if (device === this.o.deviceId || this.o.ignore?.(device)) continue;
			if (seqs.some((seq) => seq > (this.state.applied[device] ?? 0))) download = true;
		}
		return { upload: await this.hasUpload(), download };
	}
}

const importOpts = { backup: false, origin: BUCKET_ORIGIN };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
