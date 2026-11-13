/*
	State and operations behind the Beancount sync page (/sync/beancount): the
	local scan, per-peer remote scans and baselines, the user's pull/skip
	choices, applying a pull, and the per-file diff/merge modal. The page keeps
	only view state (folder expansion, view mode) and markup.

	Pure row/tree/count logic lives in syncTree.ts. Classification is in
	syncDiff.ts. See doc/projects/2026-07-02_beancount-peer-sync.md.
*/
import type { PeerSyncBaseline } from '#lib/data/model';
import Notifier from '#lib/utils/notifier';
import { OpfsSource } from './OpfsSource';
import { PeerSource } from './PeerSource';
import { peerConnection } from './peerConnection.svelte';
import { announceSyncedToPeer, pullFiles } from './pullFiles';
import { normalizeEol, type SyncEntry } from './SyncSource';
import { getBaseline, updateBaseline } from './syncBaseline';
import { diffAgainstBaseline, type DiffEntry, type SyncAction } from './syncDiff';
import { buildFileRows, countActions, countPeerDiffs } from './syncTree';

export type ConnState = 'connecting' | 'online' | 'offline';

/** Grace window after joining the room during which an absent trusted peer still
 *  reads as "connecting" rather than "offline". Nostr-relay discovery latency is
 *  highly variable (real-world joins have taken well past a few seconds). */
export const DISCOVERY_GRACE_MS = 15_000;

/** Cached scan, baseline and user choices for one peer. Deliberately survives
 *  switching peers, so re-selecting a peer never re-triggers a scan. */
export interface PeerSyncState {
	remoteEntries: SyncEntry[] | null;
	remoteLoading: boolean;
	remoteError: string | null;
	fetchedTrysteroId: string | null;
	baseline: Map<string, PeerSyncBaseline>;
	overrides: Map<string, SyncAction>;
}

const EMPTY_PEER_STATE: PeerSyncState = {
	remoteEntries: null,
	remoteLoading: false,
	remoteError: null,
	fetchedTrysteroId: null,
	baseline: new Map(),
	overrides: new Map()
};

export class BeancountSyncController {
	readonly presence = peerConnection.presence;
	readonly opfsSource = new OpfsSource();

	// ─── Connection ────────────────────────────────────────────────────────────

	discoveryDone = $state(false);
	activePeerId = $state<string | null>(null);

	activePeer = $derived(
		this.activePeerId
			? (this.presence.trustedPeers.find((p) => p.id === this.activePeerId) ?? null)
			: null
	);
	onlineTrustedPeers = $derived(
		this.presence.trustedPeers.filter((tp) => this.peerState(tp.id) === 'online')
	);

	peerState(persistentId: string): ConnState {
		if (this.presence.onlineTrysteroId(persistentId)) return 'online';
		if (!this.presence.isInRoom || !this.discoveryDone) return 'connecting';
		return 'offline';
	}

	/** Call from an `$effect`: restarts the discovery grace window whenever the room is (re)joined. */
	trackDiscovery(): (() => void) | void {
		this.discoveryDone = false;
		if (!this.presence.isInRoom) return;
		const timer = setTimeout(() => (this.discoveryDone = true), DISCOVERY_GRACE_MS);
		return () => clearTimeout(timer);
	}

	// ─── Local scan ────────────────────────────────────────────────────────────

	localEntries = $state<SyncEntry[]>([]);
	localLoaded = $state(false);
	localError = $state<string | null>(null);

	async loadLocalTree() {
		try {
			this.localEntries = await this.opfsSource.listTree();
		} catch (e) {
			this.localError = (e as Error).message;
		} finally {
			this.localLoaded = true;
		}
	}

	// ─── Per-peer state ────────────────────────────────────────────────────────

	peerStates = $state(new Map<string, PeerSyncState>());

	/** Immutable-style patch: clones the map and the one entry being touched, then
	 *  reassigns — Svelte tracks the reassignment, not deep mutation. */
	private patchPeerState(peerId: string, patch: Partial<PeerSyncState>) {
		const next = new Map(this.peerStates);
		next.set(peerId, { ...(next.get(peerId) ?? EMPTY_PEER_STATE), ...patch });
		this.peerStates = next;
	}

	/** Not `$state` — a plain cache keyed by peer id. Cheap: each PeerSource just
	 *  delegates to the shared `protocol`, so this never re-registers trystero actions. */
	private peerSources = new Map<string, PeerSource>();

	private sourceFor(peerId: string): PeerSource | null {
		if (!peerConnection.protocol) return null;
		let source = this.peerSources.get(peerId);
		if (!source) {
			source = new PeerSource(this.presence, peerConnection.protocol, peerId);
			this.peerSources.set(peerId, source);
		}
		return source;
	}

	/** Fetches one peer's remote tree + baseline together and caches both — "on
	 *  contact" is exactly when a fresh peer-sent hash list can be compared against
	 *  the locally-stored baseline hashes from the last sync with it. */
	async refreshPeer(peerId: string, trysteroId: string) {
		const source = this.sourceFor(peerId);
		if (!source) return;
		this.patchPeerState(peerId, {
			fetchedTrysteroId: trysteroId,
			remoteLoading: true,
			remoteError: null
		});
		try {
			const [remoteEntries, baseline] = await Promise.all([source.listTree(), getBaseline(peerId)]);
			this.patchPeerState(peerId, { remoteEntries, baseline, remoteLoading: false });
		} catch (e) {
			this.patchPeerState(peerId, {
				remoteError: (e as Error).message,
				remoteEntries: null,
				remoteLoading: false
			});
		}
	}

	/** Call from an `$effect`: scans every trusted, online peer in the background —
	 *  not just the active one — so the picker shows live counts and switching peers
	 *  never waits on a fresh fetch. */
	scanOnlinePeers() {
		if (!peerConnection.protocol) return;
		for (const tp of this.onlineTrustedPeers) {
			const trysteroId = this.presence.onlineTrysteroId(tp.id);
			if (!trysteroId) continue;
			const state = this.peerStates.get(tp.id);
			if (state?.fetchedTrysteroId === trysteroId || state?.remoteLoading) continue;
			void this.refreshPeer(tp.id, trysteroId);
		}
	}

	/** Live pull/conflict counts for the peer picker — reuses whatever
	 *  `refreshPeer` already cached, without forcing a fetch. */
	diffCountsFor(peerId: string): { pull: number; conflict: number } | null {
		if (!this.localLoaded) return null;
		const state = this.peerStates.get(peerId);
		if (!state || state.remoteEntries === null) return null;
		return countPeerDiffs(
			diffAgainstBaseline(this.localEntries, state.remoteEntries, state.baseline),
			state.overrides
		);
	}

	refreshing = $state(false);

	/** Re-scans local files and re-checks the active peer. Content hashes are
	 *  recomputed on every load, but there is no live watcher, so a stale in-memory
	 *  scan needs an explicit refresh. */
	async refreshAll() {
		const peer = this.activePeer;
		if (!peer) return;
		this.refreshing = true;
		try {
			await this.loadLocalTree();
			const trysteroId = this.presence.onlineTrysteroId(peer.id);
			if (trysteroId) {
				await this.refreshPeer(peer.id, trysteroId);
			} else {
				this.patchPeerState(peer.id, { fetchedTrysteroId: null, remoteEntries: null });
			}
		} finally {
			this.refreshing = false;
		}
	}

	// ─── Active peer's view ────────────────────────────────────────────────────

	activeState = $derived(
		this.activePeerId
			? (this.peerStates.get(this.activePeerId) ?? EMPTY_PEER_STATE)
			: EMPTY_PEER_STATE
	);
	remoteEntries = $derived(this.activeState.remoteEntries);
	remoteLoading = $derived(this.activeState.remoteLoading);
	remoteError = $derived(this.activeState.remoteError);
	baseline = $derived(this.activeState.baseline);
	overrides = $derived(this.activeState.overrides);
	peerSource = $derived(this.activePeerId ? this.sourceFor(this.activePeerId) : null);

	/** Only classify once there is a remote scan — an offline or not-yet-loaded
	 *  peer must never be treated as "remote deleted everything". */
	diffByPath = $derived.by(() => {
		if (!this.activePeer || this.remoteEntries === null) return new Map<string, DiffEntry>();
		const entries = diffAgainstBaseline(this.localEntries, this.remoteEntries, this.baseline);
		return new Map(entries.map((e) => [e.path, e]));
	});

	/** Every file on either side, regardless of folder collapse state. */
	fileRows = $derived(
		buildFileRows(this.localEntries, this.remoteEntries ?? [], this.diffByPath, this.overrides)
	);
	conflictRows = $derived(this.fileRows.filter((r) => r.status === 'conflict'));
	differsRows = $derived(this.fileRows.filter((r) => r.status === 'differs'));
	remoteNewerRows = $derived(this.fileRows.filter((r) => r.status === 'remote-newer'));
	localNewerRows = $derived(this.fileRows.filter((r) => r.status === 'local-newer'));
	unchangedRows = $derived(this.fileRows.filter((r) => !r.status || r.status === 'unchanged'));
	counts = $derived(countActions(this.fileRows));

	/** Per-path action chosen by the user, overriding the diff's default. */
	setAction(path: string, action: SyncAction) {
		if (!this.activePeerId) return;
		const next = new Map(this.overrides);
		next.set(path, action);
		this.patchPeerState(this.activePeerId, { overrides: next });
	}

	pullAll(rows: { path: string }[]) {
		if (!this.activePeerId) return;
		const next = new Map(this.overrides);
		for (const r of rows) next.set(r.path, 'pull');
		this.patchPeerState(this.activePeerId, { overrides: next });
	}

	// ─── Diff-only filter ──────────────────────────────────────────────────────

	/** Hide unchanged files, so only the ones needing a sync decision remain. */
	showDiffsOnly = $state(false);
	/** True once the user has toggled the filter for the active peer — suppresses
	 *  the auto-default so a manual "show all" sticks. */
	diffsOnlyUserSet = $state(false);

	toggleShowDiffsOnly() {
		this.showDiffsOnly = !this.showDiffsOnly;
		this.diffsOnlyUserSet = true;
	}

	/** Call from an `$effect`: defaults the filter to "diffs only" the first time
	 *  this peer's diff counts become known. */
	applyDefaultDiffsOnly() {
		if (this.diffsOnlyUserSet || !this.activePeer || this.remoteEntries === null) return;
		const { pull, conflict, differs } = this.counts;
		this.showDiffsOnly = pull + conflict + differs > 0;
	}

	// ─── Peer selection ────────────────────────────────────────────────────────

	/** Resets only UI state tied to "which peer's tree am I looking at"; cached scans stay. */
	selectPeer(id: string | null) {
		this.activePeerId = id;
		this.diffModalPath = null;
		this.showDiffsOnly = false;
		this.diffsOnlyUserSet = false;
	}

	// ─── Baseline bookkeeping ──────────────────────────────────────────────────

	/** Records agreement for one path with the active peer: updates the baseline,
	 *  announces it to the peer, and clears any pending override. */
	private async recordSynced(path: string, local: SyncEntry, remote: SyncEntry) {
		const peer = this.activePeer;
		if (!peer) return;
		const synced = [{ path, local, remote }];
		await updateBaseline(peer.id, synced);
		if (this.peerSource) await announceSyncedToPeer(this.peerSource, synced);
		const nextOverrides = new Map(this.overrides);
		nextOverrides.delete(path);
		this.patchPeerState(peer.id, {
			baseline: await getBaseline(peer.id),
			overrides: nextOverrides
		});
	}

	/** Fast-forwards the baseline when a live re-read at preview time finds both
	 *  sides already match, without waiting for the next scan. */
	async markSynced(path: string) {
		const localEntry = this.localEntries.find((e) => e.path === path);
		const remoteEntry = this.remoteEntries?.find((e) => e.path === path);
		if (!localEntry || !remoteEntry) return;
		await this.recordSynced(path, localEntry, remoteEntry);
	}

	// ─── Apply (pull) ──────────────────────────────────────────────────────────

	applying = $state(false);
	applyError = $state<string | null>(null);

	async applyChanges() {
		const peer = this.activePeer;
		if (!peer || !this.peerSource) return;
		const toPull = this.fileRows.filter((r) => r.effectiveAction === 'pull');
		if (toPull.length === 0) return;

		this.applying = true;
		this.applyError = null;
		const { freshLocal, failures } = await pullFiles(
			peer.id,
			this.peerSource,
			this.opfsSource,
			toPull
		);

		this.localEntries = freshLocal;
		this.localLoaded = true;
		this.patchPeerState(peer.id, { overrides: new Map(), baseline: await getBaseline(peer.id) });
		this.applying = false;

		if (failures.length) {
			this.applyError = failures.join('; ');
			Notifier.error(`${failures.length} file${failures.length === 1 ? '' : 's'} failed to sync`);
		} else {
			Notifier.success(`Synced ${toPull.length} file${toPull.length === 1 ? '' : 's'}`);
		}
	}

	// ─── Per-file diff/preview modal ───────────────────────────────────────────
	// Shows what applying the row's current pull/skip selection will actually do,
	// not just a raw local-vs-remote diff.

	diffModalPath = $state<string | null>(null);
	diffModalLocalContent = $state<string | undefined>(undefined);
	diffModalRemoteContent = $state<string | undefined>(undefined);
	diffModalLoading = $state(false);
	diffModalError = $state<string | null>(null);
	markingIdentical = $state(false);
	applyingMerge = $state(false);

	/** The row for the file currently previewed — re-derives live as the user toggles pull/skip. */
	diffModalRow = $derived(
		this.diffModalPath ? (this.fileRows.find((r) => r.path === this.diffModalPath) ?? null) : null
	);

	/** Content the local file would hold after applying the row's current action —
	 *  'skip' keeps it as-is; 'pull' (or an unresolved conflict, previewed as if
	 *  pulled) makes it the remote content, or deletes it if the remote lacks it. */
	diffModalAfterContent = $derived(
		this.diffModalRow?.effectiveAction === 'skip'
			? this.diffModalLocalContent
			: this.diffModalRemoteContent
	);

	/** True once both sides have loaded and their raw content matches — independent
	 *  of the pull/skip selection. Lets the modal offer "mark as synced". */
	diffModalIdentical = $derived(
		this.diffModalLocalContent !== undefined &&
			this.diffModalRemoteContent !== undefined &&
			normalizeEol(this.diffModalLocalContent) === normalizeEol(this.diffModalRemoteContent)
	);

	async openDiffFor(path: string) {
		if (!this.peerSource) return;
		this.diffModalPath = path;
		this.diffModalLoading = true;
		this.diffModalError = null;
		this.diffModalLocalContent = undefined;
		this.diffModalRemoteContent = undefined;
		try {
			const [localContent, remoteContent] = await Promise.all([
				this.opfsSource.readFile(path),
				this.peerSource.readFile(path)
			]);
			this.diffModalLocalContent = localContent;
			this.diffModalRemoteContent = remoteContent;
		} catch (e) {
			this.diffModalError = (e as Error).message;
		} finally {
			this.diffModalLoading = false;
		}
	}

	closeDiffModal() {
		this.diffModalPath = null;
	}

	async markDiffModalIdentical() {
		const path = this.diffModalPath;
		if (!path) return;
		this.markingIdentical = true;
		try {
			await this.markSynced(path);
			Notifier.success(`${path}: contents match — marked as synced.`);
			this.closeDiffModal();
		} finally {
			this.markingIdentical = false;
		}
	}

	/** Writes the merged content (the per-hunk Theirs/Mine picks) straight to OPFS
	 *  for just this file, independent of the row's pull/skip toggle. The merge
	 *  result becomes the new sync point for both sides, as with a full pull. */
	async applyMergeForModal(mergedContent: string) {
		const peer = this.activePeer;
		const path = this.diffModalPath;
		if (!peer || !path) return;
		this.applyingMerge = true;
		try {
			await this.opfsSource.writeFile(path, mergedContent);
			const freshLocal = await this.opfsSource.listTree();
			this.localEntries = freshLocal;
			const local = freshLocal.find((e) => e.path === path);
			const remote = this.remoteEntries?.find((e) => e.path === path);
			if (local && remote) {
				await this.recordSynced(path, local, remote);
			} else {
				const nextOverrides = new Map(this.overrides);
				nextOverrides.delete(path);
				this.patchPeerState(peer.id, { overrides: nextOverrides });
			}
			Notifier.success(`${path}: merge applied.`);
			this.closeDiffModal();
		} catch (e) {
			Notifier.error(`Merge failed: ${(e as Error).message}`);
		} finally {
			this.applyingMerge = false;
		}
	}
}
