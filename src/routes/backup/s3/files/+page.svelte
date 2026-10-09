<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		ChevronDownIcon,
		ChevronRightIcon,
		FileIcon,
		FolderIcon,
		FolderOpenIcon,
		GitCompareArrowsIcon,
		RefreshCwIcon,
		ShieldCheckIcon
	} from '@lucide/svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import DiffViewer from '$lib/components/DiffViewer.svelte';
	import Notifier from '$lib/utils/notifier';
	import { isS3Configured, loadS3Config, type S3Config } from '$lib/services/s3Config';
	import { describeS3Error } from '$lib/services/s3Client';
	import { reloadLedgerFromOpfs } from '$lib/services/ledgerReload';
	import {
		compareFile,
		listFileStatuses,
		markSameContent,
		persistSession,
		openSession,
		resolveConflict,
		applyMerge,
		type FileComparison,
		type FileState,
		type FileStatusEntry,
		type S3Session
	} from '$lib/services/s3Sync';

	let cfg = $state<S3Config | null>(null);
	// Raw: the session is mutated by the sync service, which must not go through a proxy.
	let session = $state.raw<S3Session | null>(null);
	let entries = $state<FileStatusEntry[]>([]);
	let loading = $state(false);
	let loadError = $state<string | null>(null);

	type Filter = 'conflicts' | 'changes' | 'all';
	let filter = $state<Filter>('changes');
	let filterTouched = false;

	async function refresh() {
		if (!cfg) return;
		loading = true;
		loadError = null;
		try {
			session = await openSession(cfg);
			entries = await listFileStatuses(session);
			// Until the user picks a filter, show the most useful one: conflicts, else any change.
			if (!filterTouched) {
				filter = entries.some((e) => e.state === 'conflict')
					? 'conflicts'
					: entries.some((e) => e.state !== 'unchanged')
						? 'changes'
						: 'all';
			}
		} catch (e) {
			loadError = e instanceof Error ? e.message : describeS3Error(e);
		} finally {
			loading = false;
		}
	}

	function setFilter(f: Filter) {
		filter = f;
		filterTouched = true;
	}

	onMount(async () => {
		const saved = await loadS3Config();
		if (!isS3Configured(saved)) {
			await goto('/settings/s3-cfg', { replaceState: true });
			return;
		}
		cfg = saved;
		if (!saved.passphrase) {
			loadError = 'Set an encryption passphrase in the S3 configuration first.';
			return;
		}
		await refresh();
	});

	const conflictCount = $derived(entries.filter((e) => e.state === 'conflict').length);
	const changeCount = $derived(entries.filter((e) => e.state !== 'unchanged').length);

	// --- tree ---

	interface Row {
		path: string;
		name: string;
		depth: number;
		kind: 'file' | 'directory';
		expanded?: boolean;
		entry?: FileStatusEntry;
		conflicts?: number;
		changes?: number;
	}

	let collapsed = $state(new Set<string>());
	let expandedDirs = $state(new Set<string>());

	function toggleDir(path: string, open: boolean) {
		// With a filter on, folders default to open; with "all", to closed.
		const target = open ? collapsed : expandedDirs;
		const next = new Set(target);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		if (open) collapsed = next;
		else expandedDirs = next;
	}

	const matches = (e: FileStatusEntry, f: Filter) =>
		f === 'all' ? true : f === 'conflicts' ? e.state === 'conflict' : e.state !== 'unchanged';

	const rows = $derived.by(() => {
		const visible = entries.filter((e) => matches(e, filter));
		const autoOpen = filter !== 'all';

		const dirs = new Map<string, { conflicts: number; changes: number }>();
		for (const e of visible) {
			const parts = e.path.split('/');
			for (let i = 1; i < parts.length; i++) {
				const dir = parts.slice(0, i).join('/');
				const d = dirs.get(dir) ?? { conflicts: 0, changes: 0 };
				if (e.state === 'conflict') d.conflicts++;
				if (e.state !== 'unchanged') d.changes++;
				dirs.set(dir, d);
			}
		}

		const out: Row[] = [];
		const isOpen = (dir: string) => (autoOpen ? !collapsed.has(dir) : expandedDirs.has(dir));
		const children = (parent: string): Row[] => {
			const prefix = parent ? parent + '/' : '';
			const result: Row[] = [];
			const seen = new Set<string>();
			for (const e of visible) {
				if (!e.path.startsWith(prefix)) continue;
				const rest = e.path.slice(prefix.length);
				const slash = rest.indexOf('/');
				if (slash === -1) {
					result.push({
						path: e.path,
						name: rest,
						depth: parent ? parent.split('/').length : 0,
						kind: 'file',
						entry: e
					});
				} else {
					const dir = prefix + rest.slice(0, slash);
					if (seen.has(dir)) continue;
					seen.add(dir);
					result.push({
						path: dir,
						name: rest.slice(0, slash),
						depth: parent ? parent.split('/').length : 0,
						kind: 'directory',
						expanded: isOpen(dir),
						...dirs.get(dir)
					});
				}
			}
			return result.sort((a, b) =>
				a.kind !== b.kind ? (a.kind === 'directory' ? -1 : 1) : a.name.localeCompare(b.name)
			);
		};
		const walk = (parent: string) => {
			for (const row of children(parent)) {
				out.push(row);
				if (row.kind === 'directory' && row.expanded) walk(row.path);
			}
		};
		walk('');
		return out;
	});

	const STATE_LABEL: Record<FileState, string> = {
		unchanged: 'In sync',
		upload: 'Upload',
		download: 'Download',
		conflict: 'Conflict'
	};
	const STATE_BADGE: Record<FileState, string> = {
		unchanged: 'badge-ghost',
		upload: 'badge-warning',
		download: 'badge-info',
		conflict: 'badge-error'
	};

	// --- compare ---

	let comparing = $state<FileStatusEntry | null>(null);
	let comparison = $state<FileComparison | null>(null);
	let compareLoading = $state(false);
	let compareError = $state<string | null>(null);
	let working = $state(false);

	async function startCompare(entry: FileStatusEntry) {
		if (!session) return;
		comparing = entry;
		comparison = null;
		compareError = null;
		compareLoading = true;
		try {
			comparison = await compareFile(session, entry.path);
		} catch (e) {
			compareError = e instanceof Error ? e.message : describeS3Error(e);
		} finally {
			compareLoading = false;
		}
	}

	function closeCompare() {
		comparing = null;
		comparison = null;
	}

	async function markInSync() {
		if (!session || !comparison) return;
		working = true;
		try {
			await markSameContent(session, comparison);
			Notifier.success(`${comparison.path}: marked as in sync.`);
			closeCompare();
			await refresh();
		} catch (e) {
			Notifier.error(e instanceof Error ? e.message : String(e));
		} finally {
			working = false;
		}
	}

	async function resolve(keep: 'local' | 'remote') {
		if (!session || !comparing) return;
		const path = comparing.path;
		working = true;
		try {
			const result = await resolveConflict(
				session,
				{ item: 'beancount', path: 'files/' + path, outcome: 'conflict' },
				keep
			);
			if (result.outcome === 'error') {
				Notifier.error(`${path}: ${result.message}`);
				return;
			}
			Notifier.success(`${path}: ${result.outcome}.`);
			if (result.outcome === 'downloaded' || result.outcome === 'deleted') {
				void reloadLedgerFromOpfs();
			}
			closeCompare();
			await refresh();
		} finally {
			working = false;
		}
	}

	/**
	 * Writes the chosen changes to this device only. The file keeps its status against the bucket
	 * (typically still a conflict), and the comparison reopens with what remains.
	 */
	async function mergeLocally(content: string) {
		if (!comparing) return;
		const path = comparing.path;
		working = true;
		try {
			const result = await applyMerge(path, content);
			if (result.outcome === 'error') {
				Notifier.error(`${path}: ${result.message}`);
				return;
			}
			void reloadLedgerFromOpfs();
			closeCompare();
			await refresh();
			const entry = entries.find((e) => e.path === path);
			if (entry && entry.state !== 'unchanged') {
				Notifier.success(`${path}: applied on this device. The rest still differs from the bucket.`);
				await startCompare(entry);
			} else {
				Notifier.success(`${path}: applied on this device. It now matches the bucket.`);
			}
		} finally {
			working = false;
		}
	}

	const isConflict = $derived(comparing?.state === 'conflict');

	// --- auto-compare ---

	let autoRunning = $state(false);
	let autoProgress = $state({ done: 0, total: 0 });

	/**
	 * Runs the manual Compare on every file that is not in sync, and marks those whose text is the
	 * same as in sync (correcting a stale manifest where needed). Files that really differ are left
	 * for manual review. The manifest and bases are written once at the end.
	 */
	async function autoCompare() {
		if (!session || autoRunning) return;
		const targets = entries.filter((e) => e.state !== 'unchanged');
		if (targets.length === 0) {
			Notifier.info('Everything is already in sync.');
			return;
		}
		autoRunning = true;
		autoProgress = { done: 0, total: targets.length };
		let marked = 0;
		let differ = 0;
		let failed = 0;
		try {
			for (const entry of targets) {
				try {
					const cmp = await compareFile(session, entry.path);
					if (cmp.sameText) {
						await markSameContent(session, cmp, { persist: false });
						marked++;
					} else {
						differ++;
					}
				} catch {
					failed++;
				}
				autoProgress.done++;
			}
			await persistSession(session);
			const parts = [`${marked} marked as in sync`, `${differ} really differ`];
			if (failed) parts.push(`${failed} failed`);
			Notifier.success(parts.join(', ') + '.');
		} catch (e) {
			Notifier.error(e instanceof Error ? e.message : describeS3Error(e));
		} finally {
			autoRunning = false;
			await refresh();
		}
	}
</script>

{#snippet stateBadge(state: FileState)}
	<span class="badge badge-sm {STATE_BADGE[state]}">{STATE_LABEL[state]}</span>
{/snippet}

<main class="flex h-screen flex-col">
	<Toolbar title="S3 Beancount Files">
		{#snippet actions()}
			<button
				class="btn btn-ghost btn-sm btn-square"
				aria-label="Refresh"
				title="Refresh"
				disabled={loading || !cfg?.passphrase}
				onclick={refresh}
			>
				<RefreshCwIcon size={20} class={loading ? 'animate-spin' : ''} />
			</button>
		{/snippet}
		{#snippet menuItems()}
			<li>
				<button disabled={autoRunning || loading || changeCount === 0} onclick={autoCompare}>
					<GitCompareArrowsIcon size={18} />
					Auto-compare
				</button>
			</li>
		{/snippet}
	</Toolbar>

	<section class="flex-1 space-y-3 overflow-y-auto touch-pan-y p-4">
		<div class="mx-auto max-w-2xl space-y-3">
			{#if loadError}
				<div class="alert alert-warning text-sm"><span>{loadError}</span></div>
			{/if}

			{#if loading && entries.length === 0}
				<div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
			{:else if session}
				{#if autoRunning}
					<div class="alert alert-info text-sm">
						<span class="loading loading-spinner loading-xs"></span>
						<span>Comparing files… {autoProgress.done} / {autoProgress.total}</span>
					</div>
				{/if}
				<div class="join w-full">
					<button
						class="btn btn-xs join-item flex-1 {filter === 'conflicts' ? 'btn-primary' : 'btn-outline'}"
						onclick={() => setFilter('conflicts')}
					>
						Conflicts ({conflictCount})
					</button>
					<button
						class="btn btn-xs join-item flex-1 {filter === 'changes' ? 'btn-primary' : 'btn-outline'}"
						onclick={() => setFilter('changes')}
					>
						Changes ({changeCount})
					</button>
					<button
						class="btn btn-xs join-item flex-1 {filter === 'all' ? 'btn-primary' : 'btn-outline'}"
						onclick={() => setFilter('all')}
					>
						All ({entries.length})
					</button>
				</div>

				{#if rows.length === 0}
					<p class="text-base-content/50 py-6 text-center text-sm">
						{filter === 'conflicts'
							? 'No conflicts.'
							: filter === 'changes'
								? 'Everything is in sync.'
								: 'No Beancount files.'}
					</p>
				{:else}
					<ul class="divide-base-300 flex flex-col divide-y">
						{#each rows as row (row.path)}
							<li>
								{#if row.kind === 'directory'}
									<button
										type="button"
										class="btn btn-ghost btn-sm w-full justify-start gap-1.5 font-mono"
										style="padding-left: {row.depth * 1.25 + 0.5}rem"
										onclick={() => toggleDir(row.path, filter !== 'all')}
									>
										{#if row.expanded}
											<FolderOpenIcon class="h-4 w-4 shrink-0 opacity-60" />
										{:else}
											<FolderIcon class="h-4 w-4 shrink-0 opacity-60" />
										{/if}
										<span class="truncate">{row.name}</span>
										{#if row.conflicts}
											<span class="badge badge-error badge-sm ml-auto">{row.conflicts}</span>
										{:else if row.changes}
											<span class="badge badge-warning badge-sm ml-auto">{row.changes}</span>
										{/if}
									</button>
								{:else if row.entry}
									<div
										class="flex items-center gap-2 py-2"
										style="padding-left: {row.depth * 1.25 + 0.5}rem"
									>
										<FileIcon class="h-3.5 w-3.5 shrink-0 opacity-50" />
										<div class="min-w-0 flex-1">
											<div class="truncate font-mono text-sm">{row.name}</div>
											{#if row.entry.reason}
												<div class="text-base-content/60 text-xs">{row.entry.reason}</div>
											{:else if !row.entry.local || !row.entry.remote}
												<div class="text-base-content/60 text-xs">
													{row.entry.local ? 'Only on this device' : 'Only in the bucket'}
												</div>
											{/if}
										</div>
										{@render stateBadge(row.entry.state)}
										{#if row.entry.state !== 'unchanged'}
											<button
												class="btn btn-xs btn-ghost"
												aria-label="Compare {row.name}"
												onclick={() => row.entry && startCompare(row.entry)}
											>
												<GitCompareArrowsIcon class="h-3.5 w-3.5" />
												Compare
											</button>
										{/if}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				<p class="text-base-content/50 text-xs">
					Compare reads both versions in full. A conflict where only line endings or the final
					newline differ is not a real conflict: mark it as in sync. Otherwise the differences are
					shown, and you can keep one side.
				</p>
			{/if}
		</div>
	</section>
</main>

{#if comparing}
	<div class="modal modal-open">
		<div class="modal-box flex h-[90vh] max-w-2xl flex-col p-0">
			<div class="border-base-300 flex items-center gap-2 border-b px-4 py-3">
				<h3 class="min-w-0 flex-1 truncate font-mono text-sm font-bold">{comparing.path}</h3>
				{@render stateBadge(comparing.state)}
				<button class="btn btn-ghost btn-sm" aria-label="Close" onclick={closeCompare}>✕</button>
			</div>
			<div class="flex-1 space-y-3 overflow-y-auto touch-pan-y p-4">
				{#if compareLoading}
					<div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
				{:else if compareError}
					<div class="alert alert-error text-sm"><span>{compareError}</span></div>
				{:else if comparison}
					{#if comparison.localText === null}
						<div class="alert alert-info text-sm">
							<span>Not on this device. The bucket's version is shown below.</span>
						</div>
					{:else if comparison.remoteText === null}
						<div class="alert alert-info text-sm">
							<span>Not in the bucket (or deleted there). This device's version is shown below.</span>
						</div>
					{:else if comparison.sameText}
						<div class="alert alert-success text-sm">
							<span>
								{#if comparison.identical}
									The two versions are identical.
								{:else}
									The text is the same: only line endings or the final newline differ. This is not a
									real conflict.
								{/if}
							</span>
						</div>
						{#if comparison.manifestStale}
								<div class="alert alert-info text-sm">
									<span>
										The bucket's manifest is out of date for this file. Marking it as in sync also
										corrects the manifest. No file is changed.
									</span>
								</div>
							{/if}
							<button class="btn btn-success btn-sm" disabled={working} onclick={markInSync}>
							{#if working}
								<span class="loading loading-spinner loading-xs"></span>
							{:else}
								<ShieldCheckIcon class="h-4 w-4" />
							{/if}
							Mark as in sync
						</button>
					{:else}
						<div class="alert alert-warning text-sm">
							<span>The content really differs.</span>
						</div>
					{/if}

					{#if comparison.localText !== null && comparison.remoteText !== null && !comparison.sameText}
						<DiffViewer
							oldText={comparison.localText}
							newText={comparison.remoteText}
							banner={{
								text: isConflict
									? 'Red lines (-) are only on this device ("Mine"). Green lines (+) are only in the bucket ("Theirs"). Every change keeps "Mine" unless you pick "Theirs". Apply merge saves only your picks, on this device only; the file stays a conflict until the two sides match, and you can merge the rest later.'
									: 'Red lines (-) are only on this device. Green lines (+) are only in the bucket.',
								alertClass: 'alert-info'
							}}
							onApplyMerge={isConflict ? mergeLocally : undefined}
							defaultMine
							applyingMerge={working}
						/>
					{:else if comparison.localText !== null && comparison.remoteText === null}
						<pre class="bg-base-200 overflow-x-auto rounded p-2 text-xs">{comparison.localText}</pre>
					{:else if comparison.localText === null && comparison.remoteText !== null}
						<pre class="bg-base-200 overflow-x-auto rounded p-2 text-xs">{comparison.remoteText}</pre>
					{/if}
				{/if}
			</div>
			{#if isConflict && comparison && !compareLoading}
				<div class="border-base-300 flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
					<span class="text-base-content/60 mr-auto text-xs">Resolve by keeping one side:</span>
					<button class="btn btn-sm btn-outline" disabled={working} onclick={() => resolve('local')}>
						Keep this device
					</button>
					<button class="btn btn-sm btn-outline" disabled={working} onclick={() => resolve('remote')}>
						Keep bucket
					</button>
				</div>
			{/if}
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={closeCompare}></button>
	</div>
{/if}
