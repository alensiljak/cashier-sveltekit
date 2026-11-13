<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import FileIcon from '@lucide/svelte/icons/file';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import GitCompareArrowsIcon from '@lucide/svelte/icons/git-compare-arrows';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import FunnelIcon from '@lucide/svelte/icons/funnel';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import DeviceLabel from '#lib/components/DeviceLabel.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import DiffViewer from '#lib/components/DiffViewer.svelte';
	import { peerConnection } from '#lib/sync/peerConnection.svelte';
	import {
		BeancountSyncController,
		type ConnState
	} from '#lib/sync/beancountSyncController.svelte';
	import {
		buildTree,
		metaLine,
		previewBanner,
		statusBadgeClass,
		statusDotClass,
		statusLabel,
		type TreeRow
	} from '#lib/sync/syncTree';

	// State and operations live in the controller (see beancountSyncController.svelte.ts);
	// this page holds only view state and the URL ↔ selected-peer wiring.
	const ctrl = new BeancountSyncController();
	const presence = ctrl.presence;
	let presenceReady = $state(false);

	const urlPeerId = $derived(page.url.searchParams.get('peer') ?? '');

	function statusClass(state: ConnState): string {
		switch (state) {
			case 'online':
				return 'status-success';
			case 'connecting':
				return 'status-warning animate-pulse';
			case 'offline':
				return 'status-error';
		}
	}

	function selectPeer(id: string) {
		ctrl.selectPeer(id);
		expandedRows = new Set();
		goto(`${page.url.pathname}?peer=${id}`, { replace: true, reset: false });
	}

	function changePeer() {
		ctrl.selectPeer(null);
		expandedRows = new Set();
		goto(page.url.pathname, { replace: true, reset: false });
	}

	onMount(async () => {
		// Kick off the local scan immediately, independent of peer selection —
		// hashing every ledger file can take a moment on a large book, so
		// starting it now means it's likely already done by the time a peer
		// is chosen/connects, instead of waiting until then to begin.
		void ctrl.loadLocalTree();
		await peerConnection.ensureInit();
		if (urlPeerId) ctrl.activePeerId = urlPeerId;
		presenceReady = true;
	});

	$effect(() => ctrl.trackDiscovery());
	$effect(() => ctrl.scanOnlinePeers());
	$effect(() => ctrl.applyDefaultDiffsOnly());

	/** Sets the DOM `indeterminate` property (not reflectable as a plain attribute) on a
	 *  checkbox — used to show an unresolved conflict as neither checked nor unchecked. */
	function indeterminateAction(node: HTMLInputElement, value: boolean) {
		node.indeterminate = value;
		return {
			update(next: boolean) {
				node.indeterminate = next;
			}
		};
	}

	// ─── Tree view state ────────────────────────────────────────────────────────

	/** Paths the user has explicitly expanded — folders default to collapsed. */
	let expandedDirs = $state(new Set<string>());

	/** Visible rows, respecting collapsed folders — for rendering the tree only.
	 *  Apply logic uses ctrl.fileRows, which ignores collapse state. */
	let treeRows = $derived(buildTree(ctrl.fileRows, expandedDirs, ctrl.showDiffsOnly));

	function toggleDir(path: string) {
		const next = new Set(expandedDirs);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		expandedDirs = next;
	}

	// Row-expand state, used by the "Compact" view mode.
	let expandedRows = $state(new Set<string>());

	function toggleRowExpand(path: string) {
		const next = new Set(expandedRows);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		expandedRows = next;
	}

	type ViewMode = 'compact' | 'grouped';
	let viewMode = $state<ViewMode>('compact');
</script>

{#snippet directoryRow(row: TreeRow)}
	<button
		type="button"
		class="btn btn-ghost btn-sm w-full justify-start gap-1.5 font-mono"
		style="padding-left: {row.depth * 1.25 + 0.5}rem"
		onclick={() => toggleDir(row.path)}
	>
		{#if row.expanded}
			<FolderOpenIcon
				class="h-4 w-4 shrink-0 {row.conflictCount
					? 'text-error'
					: row.diffCount
						? 'text-warning'
						: 'opacity-60'}"
			/>
		{:else}
			<FolderIcon
				class="h-4 w-4 shrink-0 {row.conflictCount
					? 'text-error'
					: row.diffCount
						? 'text-warning'
						: 'opacity-60'}"
			/>
		{/if}
		<span class="truncate">{row.name}</span>
		{#if row.conflictCount}
			<span class="badge badge-error badge-sm ml-auto">{row.conflictCount}</span>
		{:else if row.diffCount}
			<span class="badge badge-warning badge-sm ml-auto">{row.diffCount}</span>
		{/if}
	</button>
{/snippet}

{#snippet rowActions(row: TreeRow)}
	<div class="flex flex-wrap items-center gap-2">
		{#if row.status === 'remote-newer' || row.status === 'conflict' || row.status === 'differs' || row.status === 'local-newer'}
			<div class="join">
				<button
					type="button"
					class="btn btn-xs join-item {row.effectiveAction === 'pull'
						? 'btn-primary'
						: 'btn-outline'}"
					onclick={() => ctrl.setAction(row.path, 'pull')}
				>
					Pull
				</button>
				<button
					type="button"
					class="btn btn-xs join-item {row.effectiveAction === 'skip'
						? 'btn-neutral'
						: 'btn-outline'}"
					onclick={() => ctrl.setAction(row.path, 'skip')}
				>
					Skip
				</button>
			</div>
		{/if}
		{#if row.status && row.status !== 'unchanged'}
			<button type="button" class="btn btn-xs btn-ghost" onclick={() => ctrl.openDiffFor(row.path)}>
				<GitCompareArrowsIcon class="h-3.5 w-3.5" />
				Preview
			</button>
		{/if}
	</div>
{/snippet}

{#snippet pullCheckbox(row: TreeRow)}
	<input
		type="checkbox"
		class="checkbox checkbox-primary checkbox-sm shrink-0"
		checked={row.effectiveAction === 'pull'}
		use:indeterminateAction={row.effectiveAction === 'conflict'}
		aria-label={`Pull ${row.name}`}
		onchange={(e) => ctrl.setAction(row.path, e.currentTarget.checked ? 'pull' : 'skip')}
	/>
{/snippet}

{#snippet previewButton(row: TreeRow)}
	{#if row.status && row.status !== 'unchanged'}
		<button type="button" class="btn btn-xs btn-ghost" onclick={() => ctrl.openDiffFor(row.path)}>
			<GitCompareArrowsIcon class="h-3.5 w-3.5" />
			Preview
		</button>
	{/if}
{/snippet}

<main class="flex h-full flex-col">
	<Toolbar title="Beancount Sync">
		{#snippet actions()}
			<a
				href="/peer-sync/setup"
				class="btn btn-ghost btn-sm btn-square"
				aria-label="Peer sync setup"
				title="Peer sync setup"
			>
				<SettingsIcon size={20} />
			</a>
			<HelpButton topic="beancount-sync" />
		{/snippet}
	</Toolbar>

	<section class="flex-1 space-y-3 overflow-y-auto touch-pan-y p-4">
		{#if !ctrl.activePeer}
			<!-- Peer selection -->
			<p class="text-base-content/50 text-center text-xs">
				{ctrl.localLoaded
					? `${ctrl.localEntries.length} local file${ctrl.localEntries.length === 1 ? '' : 's'} scanned`
					: 'Scanning local files…'}
			</p>
			{#if !presenceReady}
				<div class="flex justify-center p-8">
					<span class="loading loading-spinner"></span>
				</div>
			{:else if presence.trustedPeers.length === 0}
				<div class="rounded-box bg-base-200 space-y-3 p-4 text-center text-sm">
					<p class="opacity-70">No peers configured yet.</p>
					<a href="/peer-sync" class="btn btn-primary btn-sm">Set Up Peer Sync</a>
				</div>
			{:else if !presence.isInRoom}
				<div class="rounded-box bg-base-200 space-y-3 p-4 text-center text-sm">
					<p class="opacity-70">Not connected to the peer sync room.</p>
					<a href="/peer-sync" class="btn btn-primary btn-sm">Connect via Peer Sync</a>
				</div>
			{:else if ctrl.onlineTrustedPeers.length === 0}
				<div class="rounded-box bg-base-200 space-y-2 p-4 text-center text-sm">
					<span class="loading loading-spinner loading-sm"></span>
					<p class="opacity-70">Waiting for a trusted peer to come online…</p>
				</div>
			{:else}
				<div class="rounded-box bg-base-200 p-3">
					<p class="mb-2 text-sm font-semibold opacity-70">Select a peer to sync with</p>
					<ul class="space-y-2">
						{#each ctrl.onlineTrustedPeers as tp (tp.id)}
							{@const counts = ctrl.diffCountsFor(tp.id)}
							<li>
								<button
									type="button"
									class="btn btn-outline btn-block justify-start gap-3"
									onclick={() => selectPeer(tp.id)}
								>
									<span class="status {statusClass(ctrl.peerState(tp.id))} status-sm"></span>
									<span class="flex flex-1 items-baseline overflow-hidden text-left"
										><DeviceLabel name={tp.name} fingerprint={tp.fingerprint} /></span
									>
									{#if counts === null}
										<span class="loading loading-spinner loading-xs opacity-50"></span>
									{:else if counts.conflict > 0 || counts.pull > 0}
										{#if counts.conflict > 0}
											<span class="badge badge-error badge-sm"
												>{counts.conflict} conflict{counts.conflict === 1 ? '' : 's'}</span
											>
										{/if}
										{#if counts.pull > 0}
											<span class="badge badge-success badge-sm">{counts.pull} to pull</span>
										{/if}
									{:else}
										<span class="badge badge-ghost badge-sm">synced</span>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		{:else}
			<!-- Peer context -->
			<div class="rounded-box bg-base-200 flex items-center gap-2 p-3 text-sm">
				<span class="status {statusClass(ctrl.peerState(ctrl.activePeer.id))} status-sm"></span>
				<span class="opacity-60">Syncing with:</span>
				<span class="flex flex-1 items-baseline overflow-hidden font-semibold"
					><DeviceLabel
						name={ctrl.activePeer.name}
						fingerprint={ctrl.activePeer.fingerprint}
					/></span
				>
				<button
					class="btn btn-ghost btn-xs"
					disabled={ctrl.refreshing}
					onclick={() => ctrl.refreshAll()}
					title="Re-scan local files and re-check the peer"
				>
					{#if ctrl.refreshing}
						<span class="loading loading-spinner loading-xs"></span>
					{:else}
						<RefreshCwIcon class="h-3.5 w-3.5" />
					{/if}
					Refresh
				</button>
				<button class="btn btn-ghost btn-xs" onclick={changePeer}>Change</button>
				<button
					class="btn btn-xs {ctrl.showDiffsOnly ? 'btn-primary' : 'btn-ghost'}"
					onclick={() => ctrl.toggleShowDiffsOnly()}
					title={ctrl.showDiffsOnly
						? 'Showing differences only — click to show all files'
						: 'Show differences only'}
				>
					<FunnelIcon class="h-3.5 w-3.5" />
				</button>
			</div>

			<!-- View-mode switcher -->
			<div class="join w-full">
				<button
					type="button"
					class="btn btn-xs join-item flex-1 {viewMode === 'compact'
						? 'btn-outline btn-primary'
						: ''}"
					onclick={() => (viewMode = 'compact')}>Compact</button
				>
				<button
					type="button"
					class="btn btn-xs join-item flex-1 {viewMode === 'grouped'
						? 'btn-outline btn-primary'
						: ''}"
					onclick={() => (viewMode = 'grouped')}>Grouped</button
				>
			</div>

			<!-- Summary -->
			<div class="flex flex-wrap items-center gap-2 text-sm opacity-70">
				<span>{ctrl.localEntries.length} local file{ctrl.localEntries.length === 1 ? '' : 's'}</span
				>
				{#if ctrl.remoteEntries}
					<span>·</span>
					<span
						>{ctrl.remoteEntries.length} remote file{ctrl.remoteEntries.length === 1
							? ''
							: 's'}</span
					>
					{#if ctrl.counts.pull > 0}
						<span class="badge badge-success badge-sm ml-1">{ctrl.counts.pull} to pull</span>
					{/if}
					{#if ctrl.counts.conflict > 0}
						<span class="badge badge-error badge-sm"
							>{ctrl.counts.conflict} conflict{ctrl.counts.conflict === 1 ? '' : 's'}</span
						>
					{/if}
					{#if ctrl.counts.differs > 0}
						<span class="badge badge-warning badge-sm">{ctrl.counts.differs} differ</span>
					{/if}
				{/if}
			</div>

			{#if ctrl.localError}
				<div class="alert alert-error text-sm">
					<span>Local scan failed: {ctrl.localError}</span>
				</div>
			{/if}
			{#if ctrl.remoteError}
				<div class="alert alert-warning text-sm">
					<span>Couldn't get {ctrl.activePeer.name}'s file list: {ctrl.remoteError}</span>
				</div>
			{:else if !presence.onlineTrysteroId(ctrl.activePeer.id)}
				<div class="alert alert-warning text-sm">
					<span>{ctrl.activePeer.name} is offline — showing local files only.</span>
				</div>
			{/if}

			{#if treeRows.length === 0}
				<p class="text-base-content/50 py-6 text-center text-sm">
					{ctrl.localLoaded ? 'No modified files found.' : 'Scanning local files…'}
				</p>
			{:else if viewMode === 'compact'}
				<!-- Compact — one line per file; tap to expand metadata/actions. -->
				<ul class="flex flex-col divide-y divide-base-300">
					{#each treeRows as row (row.path)}
						{#if row.kind === 'directory'}
							<li>{@render directoryRow(row)}</li>
						{:else}
							{@const isOpen = expandedRows.has(row.path)}
							<li>
								<div class="flex w-full items-center gap-2 py-2">
									<button
										type="button"
										class="flex min-w-0 flex-1 items-center gap-2 text-left"
										style="padding-left: {row.depth * 1.25}rem"
										onclick={() => toggleRowExpand(row.path)}
									>
										{#if isOpen}
											<ChevronDownIcon class="h-3.5 w-3.5 shrink-0 opacity-40" />
										{:else}
											<ChevronRightIcon class="h-3.5 w-3.5 shrink-0 opacity-40" />
										{/if}
										{#if row.status}
											<span class="status {statusDotClass(row.status)} status-sm shrink-0"></span>
										{/if}
										<span class="font-mono text-sm truncate flex-1">{row.name}</span>
									</button>
									{#if row.status === 'remote-newer' || row.status === 'conflict' || row.status === 'differs' || row.status === 'local-newer'}
										{@render pullCheckbox(row)}
									{/if}
								</div>
								{#if isOpen}
									<div
										class="flex flex-col gap-2 pb-3 text-xs"
										style="padding-left: {row.depth * 1.25 + 1.375}rem"
									>
										{#if row.status}
											<span class="badge badge-sm {statusBadgeClass(row.status)} w-fit"
												>{statusLabel(row.status)}</span
											>
										{/if}
										<span class="opacity-60">{metaLine(row.local, 'Local', '— missing')}</span>
										<span class="opacity-60"
											>{metaLine(
												row.remote,
												'Remote',
												ctrl.remoteEntries ? '— missing' : '— unknown (peer offline)'
											)}</span
										>
										{#if row.status && row.status !== 'unchanged'}
											{@render previewButton(row)}
										{/if}
									</div>
								{/if}
							</li>
						{/if}
					{/each}
				</ul>
			{:else}
				<!-- Grouped — sections by status, with bulk actions. Ignores folder nesting. -->
				<div class="flex flex-col gap-3">
					{#if ctrl.differsRows.length > 0}
						<div class="rounded-box bg-warning/10 p-3">
							<div class="mb-2">
								<h3 class="text-sm font-semibold">
									Differs <span class="badge badge-warning badge-sm">{ctrl.differsRows.length}</span
									>
								</h3>
								<p class="text-xs opacity-60">
									Never synced with this peer, so it's unknown which copy is newer. Preview to
									compare.
								</p>
							</div>
							<ul class="flex flex-col gap-2">
								{#each ctrl.differsRows as row (row.path)}
									<li class="rounded-box bg-base-100 p-2.5">
										<div class="flex items-center gap-2">
											<FileIcon class="h-3.5 w-3.5 shrink-0 opacity-50" />
											<span class="font-mono text-sm truncate flex-1">{row.path}</span>
										</div>
										<div class="mt-1 flex flex-col gap-0.5 text-xs opacity-60">
											<span>{metaLine(row.local, 'Local', '— missing')}</span>
											<span>{metaLine(row.remote, 'Remote', '— missing')}</span>
										</div>
										<div class="mt-2">{@render rowActions(row)}</div>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					{#if ctrl.conflictRows.length > 0}
						<div class="rounded-box bg-error/10 p-3">
							<div class="mb-2 flex items-center gap-2">
								<h3 class="flex-1 text-sm font-semibold">
									Conflicts <span class="badge badge-error badge-sm"
										>{ctrl.conflictRows.length}</span
									>
								</h3>
							</div>
							<ul class="flex flex-col gap-2">
								{#each ctrl.conflictRows as row (row.path)}
									<li class="rounded-box bg-base-100 p-2.5">
										<div class="flex items-center gap-2">
											<FileIcon class="h-3.5 w-3.5 shrink-0 opacity-50" />
											<span class="font-mono text-sm truncate flex-1">{row.path}</span>
										</div>
										<div class="mt-1 flex flex-col gap-0.5 text-xs opacity-60">
											<span>{metaLine(row.local, 'Local', '— missing')}</span>
											<span>{metaLine(row.remote, 'Remote', '— missing')}</span>
										</div>
										<div class="mt-2">{@render rowActions(row)}</div>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					{#if ctrl.remoteNewerRows.length > 0}
						<div class="rounded-box bg-success/10 p-3">
							<div class="mb-2 flex items-center gap-2">
								<h3 class="flex-1 text-sm font-semibold">
									Remote newer <span class="badge badge-success badge-sm"
										>{ctrl.remoteNewerRows.length}</span
									>
								</h3>
								<button
									type="button"
									class="btn btn-xs btn-success"
									onclick={() => ctrl.pullAll(ctrl.remoteNewerRows)}
								>
									Pull all
								</button>
							</div>
							<ul class="flex flex-col gap-2">
								{#each ctrl.remoteNewerRows as row (row.path)}
									<li class="rounded-box bg-base-100 p-2.5">
										<div class="flex items-center gap-2">
											<FileIcon class="h-3.5 w-3.5 shrink-0 opacity-50" />
											<span class="font-mono text-sm truncate flex-1">{row.path}</span>
										</div>
										<div class="mt-1 flex flex-col gap-0.5 text-xs opacity-60">
											<span>{metaLine(row.local, 'Local', '— missing')}</span>
											<span>{metaLine(row.remote, 'Remote', '— missing')}</span>
										</div>
										<div class="mt-2">{@render rowActions(row)}</div>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					{#if ctrl.localNewerRows.length > 0}
						<div class="collapse-arrow bg-info/10 rounded-box collapse">
							<input type="checkbox" />
							<div class="collapse-title min-h-0 py-2 text-sm font-semibold">
								Local newer <span class="badge badge-info badge-sm"
									>{ctrl.localNewerRows.length}</span
								> — skipped by default; no push in v1, but you can Pull to overwrite with the remote copy
							</div>
							<div class="collapse-content">
								<ul class="flex flex-col gap-2 pt-1">
									{#each ctrl.localNewerRows as row (row.path)}
										<li class="rounded-box bg-base-100 p-2.5">
											<div class="flex items-center gap-2">
												<FileIcon class="h-3.5 w-3.5 shrink-0 opacity-50" />
												<span class="font-mono text-sm truncate flex-1">{row.path}</span>
											</div>
											<div class="mt-2">{@render rowActions(row)}</div>
										</li>
									{/each}
								</ul>
							</div>
						</div>
					{/if}

					{#if ctrl.unchangedRows.length > 0}
						<div class="collapse-arrow bg-base-200 rounded-box collapse">
							<input type="checkbox" />
							<div class="collapse-title min-h-0 py-2 text-sm font-semibold opacity-60">
								Unchanged <span class="badge badge-ghost badge-sm">{ctrl.unchangedRows.length}</span
								>
							</div>
							<div class="collapse-content">
								<ul class="flex flex-col gap-1 pt-1 text-xs opacity-50">
									{#each ctrl.unchangedRows as row (row.path)}
										<li class="font-mono">{row.path}</li>
									{/each}
								</ul>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	</section>

	{#if ctrl.activePeer}
		<!-- Apply bar -->
		<div class="border-base-300 border-t p-4">
			{#if ctrl.applyError}
				<div class="alert alert-error mb-2 text-xs"><span>{ctrl.applyError}</span></div>
			{/if}
			<button
				class="btn btn-primary w-full"
				disabled={ctrl.counts.pull === 0 || ctrl.applying}
				onclick={() => ctrl.applyChanges()}
			>
				{#if ctrl.applying}
					<span class="loading loading-spinner loading-sm"></span>
				{:else}
					<DownloadIcon class="h-4 w-4" />
				{/if}
				{ctrl.counts.pull > 0
					? `Pull ${ctrl.counts.pull} file${ctrl.counts.pull === 1 ? '' : 's'}`
					: 'Nothing to pull'}
			</button>
			{#if ctrl.counts.conflict + ctrl.counts.differs > 0}
				<p class="mt-2 text-center text-xs opacity-60">
					{ctrl.counts.conflict + ctrl.counts.differs} file{ctrl.counts.conflict +
						ctrl.counts.differs ===
					1
						? ''
						: 's'} need a decision above.
				</p>
			{/if}
		</div>
	{/if}
</main>

<!-- ─── Per-file diff/preview modal ───────────────────────────────────────── -->
{#if ctrl.diffModalPath}
	<div class="modal modal-open">
		<div class="modal-box flex h-[90vh] max-w-2xl flex-col p-0">
			<div class="border-base-300 flex items-center gap-2 border-b px-4 py-3">
				<h3 class="min-w-0 flex-1 truncate font-mono font-bold text-sm">{ctrl.diffModalPath}</h3>
				<button class="btn btn-ghost btn-sm" onclick={() => ctrl.closeDiffModal()}>✕</button>
			</div>
			<div class="flex-1 overflow-y-auto touch-pan-y p-4">
				{#if ctrl.diffModalLoading}
					<div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
				{:else if ctrl.diffModalError}
					<div class="alert alert-error text-sm"><span>{ctrl.diffModalError}</span></div>
				{:else}
					<DiffViewer
						oldText={ctrl.diffModalLocalContent ?? ''}
						newText={ctrl.diffModalAfterContent ?? ''}
						banner={previewBanner(ctrl.diffModalRow)}
						identicalMessage={ctrl.diffModalRow?.effectiveAction === 'skip'
							? 'No changes will be applied.'
							: 'Files are identical.'}
						onMarkIdentical={ctrl.diffModalIdentical
							? () => ctrl.markDiffModalIdentical()
							: undefined}
						markingIdentical={ctrl.markingIdentical}
						onApplyMerge={(merged: string) => ctrl.applyMergeForModal(merged)}
						applyingMerge={ctrl.applyingMerge}
					/>
				{/if}
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => ctrl.closeDiffModal()}
		></button>
	</div>
{/if}
