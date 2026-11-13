/*
	The Sync hub's state: the last known status of every sync channel, kept in memory so that
	opening the hub or the home card costs no network traffic. A channel is only contacted when the
	user asks (`check`, `sync`), or, for `checkAll`, when the caller decides to.

	Channels and storage are injected so this can be tested without services; the app's instance is
	in hub.ts.
*/
import {
	emptySnapshot,
	newestSync,
	overallState,
	type ChannelId,
	type ChannelSnapshot,
	type OverallState,
	type SyncChannel,
	type SyncResult
} from './channel';

export interface SyncHubDeps {
	now?: () => Date;
	/** Persists when each channel last synced (ISO strings by channel id). */
	store?: {
		load(): Promise<Record<string, string>>;
		save(map: Record<string, string>): Promise<void>;
	};
	/** Called after a sync merged records into the ledger. */
	onMerged?: () => Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class SyncHub {
	readonly channels: SyncChannel[];
	private readonly deps: Required<SyncHubDeps>;

	snapshots = $state<Record<string, ChannelSnapshot>>({});
	loaded = $state(false);

	constructor(channels: SyncChannel[], deps: SyncHubDeps = {}) {
		this.channels = channels;
		this.deps = {
			now: deps.now ?? (() => new Date()),
			store: deps.store ?? { load: async () => ({}), save: async () => undefined },
			onMerged: deps.onMerged ?? (async () => undefined)
		};
		for (const c of channels) this.snapshots[c.id] = emptySnapshot();
	}

	/** The channels the user turned on, in display order. */
	get enabled(): SyncChannel[] {
		return this.channels.filter((c) => c.isEnabled());
	}

	/** One verdict across the enabled channels (see `overallState`). */
	get overall(): OverallState {
		return overallState(
			this.enabled.map((c) => this.snapshotOf(c.id)),
			this.deps.now()
		);
	}

	/** The most recent completed sync across the enabled channels. */
	get newestSync(): Date | null {
		return newestSync(this.enabled.map((c) => this.snapshotOf(c.id)));
	}

	snapshotOf(id: ChannelId): ChannelSnapshot {
		return this.snapshots[id] ?? emptySnapshot();
	}

	private patch(id: ChannelId, patch: Partial<ChannelSnapshot>) {
		this.snapshots[id] = { ...this.snapshotOf(id), ...patch };
	}

	private channel(id: ChannelId): SyncChannel {
		const c = this.channels.find((x) => x.id === id);
		if (!c) throw new Error(`Unknown sync channel: ${id}`);
		return c;
	}

	/** Reads the stored last-sync times. Local only. Safe to call on every page open. */
	async load() {
		const stored = await this.deps.store.load();
		for (const c of this.channels) {
			const own = await c.lastSync?.().catch(() => null);
			const iso = stored[c.id];
			this.patch(c.id, { lastSync: own ?? (iso ? new Date(iso) : null) });
		}
		this.loaded = true;
	}

	/** Compares one channel with the other side. Contacts the network. */
	async check(id: ChannelId): Promise<ChannelSnapshot> {
		const channel = this.channel(id);
		const current = this.snapshotOf(id);
		if (current.busy || current.status === 'checking') return current;
		const reason = channel.unavailableReason();
		if (reason) {
			this.patch(id, { status: 'error', error: reason, checkedAt: this.deps.now() });
			return this.snapshotOf(id);
		}
		this.patch(id, { status: 'checking', error: undefined });
		try {
			const status = await channel.check();
			this.patch(id, { status, checkedAt: this.deps.now() });
		} catch (e) {
			this.patch(id, { status: 'error', error: message(e), checkedAt: this.deps.now() });
		}
		return this.snapshotOf(id);
	}

	/** Checks every enabled channel that can be reached right now. */
	async checkAll() {
		await Promise.all(
			this.enabled.filter((c) => !c.unavailableReason()).map((c) => this.check(c.id))
		);
	}

	/** Syncs one channel. Reports the outcome instead of notifying: the caller decides how to show it. */
	async sync(id: ChannelId): Promise<SyncResult> {
		const channel = this.channel(id);
		if (this.snapshotOf(id).busy) return { ok: false, merged: false, errors: ['Already syncing'] };
		const reason = channel.unavailableReason();
		if (reason) {
			this.patch(id, { status: 'error', error: reason });
			return { ok: false, merged: false, errors: [reason] };
		}
		this.patch(id, { busy: true, error: undefined });
		try {
			const { errors, merged } = await channel.sync();
			if (merged) await this.deps.onMerged();
			if (errors.length) {
				this.patch(id, { status: 'error', error: errors.join('; '), checkedAt: this.deps.now() });
				return { ok: false, merged, errors };
			}
			const at = this.deps.now();
			this.patch(id, { status: 'same', checkedAt: at, lastSync: at });
			await this.remember(id, at);
			return { ok: true, merged, errors: [] };
		} catch (e) {
			this.patch(id, { status: 'error', error: message(e), checkedAt: this.deps.now() });
			return { ok: false, merged: false, errors: [message(e)] };
		} finally {
			this.patch(id, { busy: false });
		}
	}

	private async remember(id: ChannelId, at: Date) {
		try {
			const stored = await this.deps.store.load();
			await this.deps.store.save({ ...stored, [id]: at.toISOString() });
		} catch (e) {
			console.warn('[sync-hub] Could not store the last sync time', e);
		}
	}
}
