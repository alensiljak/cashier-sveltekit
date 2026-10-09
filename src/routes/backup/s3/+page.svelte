<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import { isS3Configured, loadS3Config, type S3Config } from '#lib/services/s3Config';
	import { describeS3Error } from '#lib/services/s3Client';
	import type { SyncDirection } from '#lib/services/s3SyncPlan';
	import {
		applyDeletion,
		fetchCrdtSyncStatus,
		fetchFileSyncStatus,
		fetchRemoteOverview,
		getLastSync,
		listBucketDevices,
		openSession,
		type BucketDevice,
		resolveConflict,
		runSync,
		type FileSyncOverview,
		type RemoteItemStatus,
		type RemoteOverview,
		type S3Session,
		type SyncItem,
		type SyncLine
	} from '#lib/services/s3Sync';
	import { reloadLedgerFromOpfs } from '#lib/services/ledgerReload';
	import { trustDevice } from '#lib/sync/ydocDevices';
	import Notifier from '#lib/utils/notifier';
	import {
		ArrowDownIcon,
		ArrowUpIcon,
		CheckIcon,
		CloudDownloadIcon,
		CloudUploadIcon,
		RefreshCwIcon,
		SettingsIcon,
		TriangleAlertIcon,
		UserCheckIcon
	} from '@lucide/svelte';

	let cfg = $state<S3Config | null>(null);
	let ready = $state(false);

	let overview = $state<RemoteOverview | null>(null);
	let lastSync = $state<Date | null>(null);
	let checkingRemote = $state(false);
	let fileStatus = $state<FileSyncOverview | null>(null);
	let crdtStatus = $state<Awaited<ReturnType<typeof fetchCrdtSyncStatus>> | null>(null);
	let devices = $state<BucketDevice[]>([]);

	let trusting = $state<BucketDevice | null>(null);
	let trustName = $state('');

	function startTrust(d: BucketDevice) {
		trusting = d;
		trustName = `Device ${d.deviceId.slice(0, 6)}`;
	}

	async function confirmTrust() {
		if (!trusting) return;
		const d = trusting;
		trusting = null;
		await trustDevice(d.deviceId, trustName);
		Notifier.success('Device trusted');
		await refreshStatus();
	}

	const statusRows: { label: string; key: keyof RemoteOverview }[] = [
		{ label: 'Settings', key: 'settings' },
		{ label: 'Scheduled Transactions', key: 'scheduled' },
		{ label: 'Local Transactions', key: 'xacts' },
		{ label: 'Beancount Files', key: 'beancount' }
	];

	/** Reads the server-side modification times. A listing only, so it works without a passphrase. */
	async function refreshStatus() {
		if (!cfg) return;
		checkingRemote = true;
		try {
			[overview, lastSync, devices] = await Promise.all([
				fetchRemoteOverview(cfg),
				getLastSync(),
				listBucketDevices(cfg)
			]);
			// The comparison decrypts the bucket's data, so it needs the passphrase.
			fileStatus = null;
			crdtStatus = null;
			if (cfg.passphrase) {
				try {
					[fileStatus, crdtStatus] = await Promise.all([
						fetchFileSyncStatus(cfg),
						fetchCrdtSyncStatus(cfg)
					]);
				} catch (e) {
					console.warn('[s3-sync] Could not compare with the bucket', e);
				}
			}
		} catch (e) {
			Notifier.error(
				'Could not read the bucket: ' + (e instanceof Error ? e.message : describeS3Error(e))
			);
		} finally {
			checkingRemote = false;
		}
	}

	/** True when the bucket holds newer data for this item that an upload could overwrite. */
	function hasNewerRemote(key: keyof RemoteOverview): boolean {
		if (key === 'settings' || key === 'beancount') {
			const s = fileStatus?.[key];
			return !!s && (s.download > 0 || s.conflict > 0);
		}
		// CRDT stores merge on download and each device uploads only its own file: nothing to overwrite.
		return false;
	}

	let overwriteDialog = $state<HTMLDialogElement>();
	let overwriteLabels = $state<string[]>([]);

	/** Asks for confirmation when uploading would overwrite newer data in the bucket. */
	function requestUpload() {
		const stale = statusRows.filter(
			(r) => selectedItems().includes(r.key as SyncItem) && hasNewerRemote(r.key)
		);
		if (stale.length === 0) {
			void run('upload');
			return;
		}
		overwriteLabels = stale.map((r) => r.label);
		overwriteDialog?.showModal();
	}

	type BadgeKind = 'up' | 'down' | 'conflict' | 'ok';
	type Badge = { text: string; cls: string; kinds: BadgeKind[]; count?: string };

	/** What a sync of this item would do, or null when it is in sync or unknown. */
	function badgeFor(key: keyof RemoteOverview): Badge | null {
		if (key === 'settings' || key === 'beancount') {
			const s = fileStatus?.[key];
			if (!s) return null;
			const n = (count: number) => (key === 'beancount' ? ' (' + count + ')' : '');
			if (s.conflict) {
				return {
					text: 'Conflict' + n(s.conflict),
					cls: 'badge-error',
					kinds: ['conflict'],
					count: n(s.conflict)
				};
			}
			if (s.upload && s.download) {
				return {
					text: 'Upload' + n(s.upload) + ' / Download' + n(s.download),
					cls: 'badge-warning',
					kinds: ['up', 'down']
				};
			}
			if (s.upload) {
				return {
					text: 'Upload needed' + n(s.upload),
					cls: 'badge-warning',
					kinds: ['up'],
					count: n(s.upload)
				};
			}
			if (s.download) {
				return {
					text: 'Download available' + n(s.download),
					cls: 'badge-warning',
					kinds: ['down'],
					count: n(s.download)
				};
			}
			return { text: 'In sync', cls: 'badge-success', kinds: ['ok'] };
		}
		// CRDT stores: compared by their Yjs state, so each item is judged on its own.
		const s = crdtStatus?.[key as 'scheduled' | 'xacts'];
		if (!s) return null;
		if (s.upload && s.download)
			return { text: 'Upload / Download', cls: 'badge-warning', kinds: ['up', 'down'] };
		if (s.upload) return { text: 'Upload needed', cls: 'badge-warning', kinds: ['up'] };
		if (s.download) return { text: 'Download available', cls: 'badge-warning', kinds: ['down'] };
		return { text: 'In sync', cls: 'badge-success', kinds: ['ok'] };
	}
	function describeItem(item: RemoteItemStatus, key: keyof RemoteOverview): string {
		if (!item.count) return 'Nothing in the bucket';
		const parts = [item.lastModified ? item.lastModified.toLocaleString() : 'unknown time'];
		if (key === 'beancount') parts.push(`${item.count} ${item.count === 1 ? 'file' : 'files'}`);
		if (item.otherDeviceModified) {
			parts.push(`other devices: ${item.otherDeviceModified.toLocaleString()}`);
		}
		return parts.join(' · ');
	}

	const include = $state<Record<SyncItem, boolean>>({
		settings: false,
		scheduled: false,
		xacts: false,
		beancount: false
	});

	const allSelected = $derived(Object.values(include).every(Boolean));
	const someSelected = $derived(Object.values(include).some(Boolean));
	let indeterminate = $derived(someSelected && !allSelected);

	function toggleSelectAll() {
		const next = !allSelected;
		for (const key of Object.keys(include) as SyncItem[]) include[key] = next;
	}

	let busy = $state(false);
	let lines = $state<SyncLine[]>([]);
	let session: S3Session | null = null;

	const conflicts = $derived(lines.filter((l) => l.outcome === 'conflict'));
	const problems = $derived(lines.filter((l) => l.outcome === 'error'));
	const pendingDeletes = $derived(lines.filter((l) => l.outcome === 'pending-delete'));
	const changed = $derived(
		lines.filter(
			(l) => l.outcome === 'uploaded' || l.outcome === 'downloaded' || l.outcome === 'deleted'
		)
	);

	function selectedItems(): SyncItem[] {
		return statusRows.map((r) => r.key as SyncItem).filter((key) => include[key]);
	}

	/** Downloaded data reaches the ledger through the working set and the OPFS files. */
	function reloadIfNeeded(done: SyncLine[]) {
		const touched = done.some(
			(l) =>
				(l.outcome === 'downloaded' && (l.item === 'xacts' || l.item === 'beancount')) ||
				(l.outcome === 'deleted' && l.item === 'beancount')
		);
		if (touched) void reloadLedgerFromOpfs();
	}

	/** Applies the deletions the user confirmed: one line, or all pending ones. */
	async function applyDeletions(targets: SyncLine[]) {
		if (!session) return;
		busy = true;
		try {
			const results: SyncLine[] = [];
			for (const line of targets) results.push(await applyDeletion(session, line));
			lines = lines.map((l) => results[targets.indexOf(l)] ?? l);
			reloadIfNeeded(results);
		} finally {
			busy = false;
		}
	}

	async function run(direction: SyncDirection) {
		if (!cfg) return;
		busy = true;
		lines = [];
		try {
			session = await openSession(cfg);
			lines = [];
			await runSync(session, direction, selectedItems(), (line) => {
				lines = [...lines, line];
			});
			reloadIfNeeded(lines);
			void refreshStatus();
			if (
				!lines.some(
					(l) => l.outcome === 'conflict' || l.outcome === 'error' || l.outcome === 'pending-delete'
				)
			) {
				Notifier.success(direction === 'upload' ? 'Upload complete' : 'Download complete');
			}
		} catch (e) {
			Notifier.error(e instanceof Error ? e.message : describeS3Error(e));
		} finally {
			busy = false;
		}
	}

	async function resolve(line: SyncLine, keep: 'local' | 'remote') {
		if (!session) return;
		busy = true;
		try {
			const result = await resolveConflict(session, line, keep);
			lines = lines.map((l) => (l === line ? result : l));
			reloadIfNeeded([result]);
		} finally {
			busy = false;
		}
	}

	onMount(async () => {
		const saved = await loadS3Config();
		if (!isS3Configured(saved)) {
			await goto('/settings/s3-cfg', { replace: true });
			return;
		}
		cfg = saved;
		ready = true;
		void refreshStatus();
	});
</script>

{#snippet badge(key: keyof RemoteOverview)}
	{@const b = badgeFor(key)}
	{#if b}
		<span class="badge badge-sm badge-soft {b.cls} ml-1 gap-0.5" title={b.text} aria-label={b.text}>
			{#each b.kinds as kind}
				{#if kind === 'up'}<ArrowUpIcon size={14} />
				{:else if kind === 'down'}<ArrowDownIcon size={14} />
				{:else if kind === 'conflict'}<TriangleAlertIcon size={14} />
				{:else}<CheckIcon size={14} />{/if}
			{/each}
			{#if b.count}<span>{b.count.trim()}</span>{/if}
		</span>
	{/if}
{/snippet}

<main class="flex h-screen flex-col">
	<Toolbar title="S3 Sync">
		{#snippet actions()}
			<a
				href="/settings/s3-cfg"
				class="btn btn-ghost btn-sm btn-square"
				aria-label="S3 Config"
				title="S3 Config"
			>
				<SettingsIcon size={20} />
			</a>
		{/snippet}
	</Toolbar>
	{#if ready && cfg}
		<section class="flex-1 space-y-4 overflow-y-auto touch-pan-y p-4">
			<div class="mx-auto max-w-2xl space-y-3">
				<div class="card bg-base-200 shadow-sm">
					<div class="card-body gap-3 p-4">
						<div class="flex items-center justify-between gap-2">
							<h2 class="card-title text-sm">Devices</h2>
							<a href="/settings/trusted-devices" class="link text-xs">Manage trusted devices</a>
						</div>
						<span class="font-mono text-xs text-base-content/60">
							{cfg.bucket}{cfg.prefix ? '/' + cfg.prefix : ''}
						</span>
						{#if devices.length === 0}
							<p class="text-xs text-base-content/50">No other device has uploaded yet.</p>
						{:else}
							<ul class="space-y-2">
								{#each devices as d (d.deviceId)}
									<li class="bg-base-300 rounded-box flex items-center gap-2 p-3">
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-2 text-sm">
												<span class="truncate font-medium">
													{d.name ?? `Device ${d.deviceId.slice(0, 6)}`}
												</span>
												{#if !d.trusted}
													<span class="badge badge-warning badge-sm">not trusted</span>
												{:else if d.readOnly}
													<span class="badge badge-neutral badge-sm">read-only</span>
												{:else}
													<span class="badge badge-success badge-sm">trusted</span>
												{/if}
											</div>
											<div class="text-xs text-base-content/50">
												{#if d.lastModified}Updated {d.lastModified.toLocaleString()}{/if}
											</div>
										</div>
										{#if !d.trusted}
											<button class="btn btn-xs btn-outline" onclick={() => startTrust(d)}>
												<UserCheckIcon size={12} />
												Trust
											</button>
										{/if}
									</li>
								{/each}
							</ul>
							<p class="text-xs text-base-content/50">
								Transactions are merged only from trusted devices.
							</p>
						{/if}
					</div>
				</div>

				<div class="card bg-base-200 shadow-sm">
					<div class="card-body gap-3 p-4">
						<div class="flex items-center justify-between gap-2">
							<h2 class="card-title text-sm">Items</h2>
							{#if checkingRemote}
								<RefreshCwIcon size={14} class="animate-spin text-base-content/40" />
							{:else}
								<button
									class="flex cursor-pointer items-center gap-1 text-xs text-base-content/40 hover:text-base-content/70"
									onclick={refreshStatus}
								>
									<RefreshCwIcon size={12} />
									refresh
								</button>
							{/if}
						</div>
						<p class="flex items-baseline justify-between gap-3 text-xs text-base-content/70">
							<span>Last sync on this device:</span>
							<span class="text-right">{lastSync ? lastSync.toLocaleString() : 'never'}</span>
						</p>
						<label class="flex cursor-pointer items-center gap-3">
							<input
								type="checkbox"
								class="checkbox checkbox-primary"
								checked={allSelected}
								bind:indeterminate
								onclick={toggleSelectAll}
							/>
							<span class="flex-1 text-sm text-base-content/60">Select all</span>
						</label>
						<div class="divider my-0"></div>
						{#each statusRows as row (row.key)}
							<label class="flex cursor-pointer items-start gap-3">
								<input
									type="checkbox"
									class="checkbox checkbox-primary mt-0.5"
									bind:checked={include[row.key as SyncItem]}
								/>
								<span class="flex-1">
									<span class="block">{row.label} {@render badge(row.key)}</span>
									{#if overview}
										<span class="block text-xs text-base-content/60">
											{describeItem(overview[row.key], row.key)}
										</span>
									{/if}
									{#if row.key === 'beancount'}
										<a href="/backup/s3/files" class="link text-xs">Review files</a>
										<span class="text-xs text-base-content/50">
											— compare versions, clear false conflicts
										</span>
									{/if}
								</span>
							</label>
						{/each}
					</div>
				</div>

				<div class="card bg-base-200 shadow-sm">
					<div class="card-body gap-3 p-4">
						<h2 class="card-title text-sm">Actions</h2>
						<div class="flex justify-center gap-3">
							<button
								class="btn btn-primary"
								disabled={!someSelected || busy}
								onclick={requestUpload}
							>
								{#if busy}<span class="loading loading-spinner loading-sm"
									></span>{:else}<CloudUploadIcon class="size-5" />{/if}
								Upload
							</button>
							<button
								class="btn btn-outline btn-error"
								disabled={!someSelected || busy}
								onclick={() => run('download')}
							>
								<CloudDownloadIcon class="size-5" />
								Download
							</button>
						</div>
						{#if !cfg.passphrase}
							<p class="text-center text-sm text-warning">
								Set an encryption passphrase in the
								<a href="/settings/s3-cfg" class="link">configuration</a> first.
							</p>
						{/if}
					</div>
				</div>

				{#if lines.length || busy}
					<div class="card bg-base-200 shadow-sm">
						<div class="card-body gap-2 p-4">
							<h2 class="card-title text-sm">
								Progress
								{#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
							</h2>
							<p class="text-sm text-base-content/70">
								{busy ? 'Working… ' : ''}{changed.length} transferred, {conflicts.length} conflicts, {problems.length}
								errors.
							</p>

							{#if pendingDeletes.length}
								<div class="card border border-error/40 bg-base-200 p-3">
									<h3 class="font-semibold">Deletions to confirm</h3>
									<p class="text-xs text-base-content/70">
										Nothing has been deleted yet. Deleting a file removes it from the bucket or from
										this device, and the other devices follow on their next sync.
									</p>
									<ul class="my-2 space-y-1 text-sm">
										{#each pendingDeletes as line (line.path)}
											<li>
												<span class="font-mono text-xs break-all">{line.path}</span>
												<span class="text-xs text-error">
													{line.deletes === 'bucket'
														? 'will be deleted from the bucket'
														: 'will be deleted from this device'}
												</span>
											</li>
										{/each}
									</ul>
									<div class="flex gap-2">
										<button
											class="btn btn-sm btn-error"
											disabled={busy}
											onclick={() => applyDeletions(pendingDeletes)}
										>
											Delete {pendingDeletes.length}
											{pendingDeletes.length === 1 ? 'file' : 'files'}
										</button>
										<button
											class="btn btn-sm btn-ghost"
											disabled={busy}
											onclick={() =>
												(lines = lines.map((l) =>
													l.outcome === 'pending-delete' ? { ...l, outcome: 'skipped' } : l
												))}
										>
											Keep them
										</button>
									</div>
								</div>
							{/if}

							{#each conflicts as line (line.path)}
								<div class="card bg-base-200 p-3">
									<div class="font-mono text-sm break-all">{line.path}</div>
									<div class="text-xs text-warning">{line.message}</div>
									<div class="mt-2 flex gap-2">
										<button
											class="btn btn-sm btn-outline"
											disabled={busy}
											onclick={() => resolve(line, 'local')}
										>
											Keep this device
										</button>
										<button
											class="btn btn-sm btn-outline"
											disabled={busy}
											onclick={() => resolve(line, 'remote')}
										>
											Keep bucket
										</button>
									</div>
								</div>
							{/each}

							<ul class="space-y-1 text-sm">
								{#each lines.filter((l) => l.outcome !== 'conflict' && l.outcome !== 'unchanged' && l.outcome !== 'pending-delete') as line (line.path)}
									<li class={line.outcome === 'error' ? 'text-error' : ''}>
										<span class="font-mono text-xs break-all">{line.path}</span>:
										{line.outcome}{line.message ? ` (${line.message})` : ''}
									</li>
								{/each}
							</ul>
						</div>
					</div>
				{/if}
			</div>
		</section>
	{/if}

	{#if trusting}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="text-lg font-bold">Trust device</h3>
				<p class="py-2 text-sm">
					Records from this device will be merged into your local transactions. ID:
					<code class="break-all">{trusting.deviceId}</code>
				</p>
				<input
					class="input input-bordered w-full"
					bind:value={trustName}
					aria-label="Device name"
				/>
				<div class="modal-action">
					<button class="btn btn-ghost" onclick={() => (trusting = null)}>Cancel</button>
					<button class="btn btn-primary" onclick={confirmTrust}>Trust</button>
				</div>
			</div>
			<button class="modal-backdrop" aria-label="Close" onclick={() => (trusting = null)}></button>
		</div>
	{/if}

	<dialog bind:this={overwriteDialog} class="modal">
		<div class="modal-box">
			<h3 class="text-lg font-bold">Overwrite newer data?</h3>
			<p class="py-3 text-sm">The bucket has newer data that this device has not downloaded:</p>
			<ul class="list-inside list-disc text-sm">
				{#each overwriteLabels as label (label)}<li>{label}</li>{/each}
			</ul>
			<p class="py-3 text-sm text-base-content/70">
				Uploading may overwrite it. Download first to avoid losing changes.
			</p>
			<div class="modal-action">
				<form method="dialog" class="flex gap-2">
					<button class="btn btn-ghost">Cancel</button>
					<button class="btn btn-error" onclick={() => run('upload')}>Upload anyway</button>
				</form>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop"><button aria-label="Close">close</button></form>
	</dialog>
</main>
