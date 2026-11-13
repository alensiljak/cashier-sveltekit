<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import { isS3Configured, loadS3Config, type S3Config } from '#lib/services/s3Config';
	import { describeS3Error } from '#lib/services/s3Client';
	import type { SyncDirection } from '#lib/services/s3SyncPlan';
	import * as view from '#lib/services/s3StatusView';
	import type { CompareStatus, ItemKey } from '#lib/services/s3StatusView';
	import { fetchCrdtSyncStatus } from '#lib/services/s3CrdtSync';
	import { fetchFileSyncStatus, type FileSyncOverview } from '#lib/services/s3FileCompare';
	import { applyDeletion, resolveConflict, runSync } from '#lib/services/s3Files';
	import {
		getLastSync,
		openSession,
		type S3Session,
		type SyncItem,
		type SyncLine
	} from '#lib/services/s3Session';
	import {
		fetchRemoteOverview,
		listBucketDevices,
		type BucketDevice,
		type RemoteOverview
	} from '#lib/services/s3Status';
	import { reloadLedgerFromOpfs } from '#lib/services/ledgerReload';
	import { trustDevice } from '#lib/sync/ydocDevices';
	import DeviceLabel from '#lib/components/DeviceLabel.svelte';
	import Notifier from '#lib/utils/notifier';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CloudDownloadIcon from '@lucide/svelte/icons/cloud-download';
	import CloudUploadIcon from '@lucide/svelte/icons/cloud-upload';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import UserCheckIcon from '@lucide/svelte/icons/user-check';

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
		trustName = d.replaces?.name ?? d.announcedName ?? `Device ${d.deviceId.slice(0, 6)}`;
	}

	async function confirmTrust() {
		if (!trusting) return;
		const d = trusting;
		trusting = null;
		try {
			// With the key from its device record, the trusted device is a checked one.
			await trustDevice(d.deviceId, trustName, d.publicKey, d.previousId);
			Notifier.success(d.replaces ? 'Device replaced' : 'Device trusted');
		} catch (e) {
			Notifier.error((e as Error).message);
		}
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

	// Display logic lives in s3StatusView.ts, so it can be tested without a bucket.
	const compare = $derived<CompareStatus>({ fileStatus, crdtStatus });
	const hasNewerRemote = (key: ItemKey) => view.hasNewerRemote(compare, key);
	const actionsFor = (key: ItemKey) => view.actionsFor(compare, key);
	const gapsFor = (key: ItemKey) => view.gapsFor(compare, key);
	const badgeFor = (key: ItemKey) => view.badgeFor(compare, key);
	const describeItem = view.describeItem;

	let overwriteDialog = $state<HTMLDialogElement>();
	let overwriteItem = $state<SyncItem | null>(null);

	/** Asks for confirmation when uploading would overwrite newer data in the bucket. */
	function requestUpload(item: SyncItem) {
		if (!hasNewerRemote(item)) {
			void run('upload', item);
			return;
		}
		overwriteItem = item;
		overwriteDialog?.showModal();
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

	function reloadIfNeeded(done: SyncLine[]) {
		if (view.touchesLedger(done)) void reloadLedgerFromOpfs();
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

	async function run(direction: SyncDirection, item: SyncItem) {
		if (!cfg) return;
		busy = true;
		lines = [];
		try {
			session = await openSession(cfg);
			lines = [];
			await runSync(session, direction, [item], (line) => {
				lines = [...lines, line];
			});
			reloadIfNeeded(lines);
			void refreshStatus();
			// Conflicts ask before the losing side is overwritten: the bucket on upload, this device on download.
			if (lines.some((l) => l.outcome === 'conflict')) overwriteDirection = direction;
			if (view.isCleanRun(lines)) {
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

	/** Set while asking whether to overwrite the conflicted files; the direction of the run. */
	let overwriteDirection = $state<SyncDirection | null>(null);

	/** Overwrites the bucket's versions (upload) or this device's (download) with the winning side. */
	async function confirmOverwrite() {
		const keep = overwriteDirection === 'upload' ? 'local' : 'remote';
		overwriteDirection = null;
		for (const line of conflicts) await resolve(line, keep);
		void refreshStatus();
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
												<span class="flex min-w-0 items-baseline font-medium">
													<DeviceLabel
														name={d.name ?? d.announcedName ?? `Device ${d.deviceId.slice(0, 6)}`}
														fingerprint={d.fingerprint}
													/>
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
												{d.replaces ? 'Replace' : 'Trust'}
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
						{#each statusRows as row (row.key)}
							{@const act = actionsFor(row.key)}
							<div
								class="flex items-start gap-3 border-t border-base-300 pt-3 first:border-t-0 first:pt-0"
							>
								<span class="min-w-0 flex-1">
									<span class="block">{row.label} {@render badge(row.key)}</span>
									{#if overview}
										<span class="block text-xs text-base-content/60">
											{describeItem(overview[row.key], row.key)}
										</span>
									{/if}
									{#each gapsFor(row.key) as g (g.deviceId)}
										<span class="block text-xs text-warning">
											Device {g.deviceId.slice(0, 6)}: change {g.expected} is missing from the bucket
										</span>
									{/each}
									{#if row.key === 'settings'}
										<a href="/sync/s3/settings" class="link text-xs">Review diff</a>
										<span class="text-xs text-base-content/50">
											— compare settings.json with the bucket
										</span>
									{/if}
									{#if row.key === 'xacts' || row.key === 'scheduled'}
										<a href="/sync/s3/records?item={row.key}" class="link text-xs">Review records</a
										>
										<span class="text-xs text-base-content/50"
											>— preview what a sync would change</span
										>
									{/if}
									{#if row.key === 'beancount'}
										<a href="/sync/s3/files" class="link text-xs">Review files</a>
										<span class="text-xs text-base-content/50">
											— compare versions, clear false conflicts
										</span>
									{/if}
								</span>
								<div class="flex shrink-0 gap-1">
									{#if row.key === 'settings'}
										<button
											class="btn btn-sm btn-outline"
											disabled={busy || act.conflict || !(act.up || act.down)}
											onclick={() =>
												act.down ? run('download', 'settings') : requestUpload('settings')}
										>
											{#if act.down}<CloudDownloadIcon class="size-4" />{:else}<CloudUploadIcon
													class="size-4"
												/>{/if}
											Sync
										</button>
									{:else}
										<button
											class="btn btn-sm btn-square btn-outline"
											aria-label="Download {row.label}"
											title="Download"
											disabled={busy || !act.down}
											onclick={() => run('download', row.key as SyncItem)}
										>
											<CloudDownloadIcon class="size-4" />
										</button>
										<button
											class="btn btn-sm btn-square btn-primary"
											aria-label="Upload {row.label}"
											title="Upload"
											disabled={busy || !act.up}
											onclick={() => requestUpload(row.key as SyncItem)}
										>
											<CloudUploadIcon class="size-4" />
										</button>
									{/if}
								</div>
							</div>
						{/each}
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

	{#if overwriteDirection && conflicts.length}
		{@const toBucket = overwriteDirection === 'upload'}
		{@const many = conflicts.length > 1}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="text-lg font-bold">
					{toBucket ? 'Overwrite the bucket?' : 'Overwrite this device?'}
				</h3>
				<p class="py-2 text-sm">
					{many ? 'These files were' : 'This file was'} changed on this device and in the bucket.
					{#if toBucket}
						Continuing replaces the bucket's {many ? 'versions' : 'version'} with this device's. Other
						devices will take {many ? 'them' : 'it'} on their next sync.
					{:else}
						Continuing replaces this device's {many ? 'versions' : 'version'} with the bucket's. The local
						changes are lost.
					{/if}
				</p>
				<ul class="space-y-1 text-sm">
					{#each conflicts as line (line.path)}
						<li class="font-mono text-xs break-all">{line.path}</li>
					{/each}
				</ul>
				<p class="text-base-content/70 py-2 text-xs">
					To see the differences first, cancel and open the diff view:
					<a class="link" href="/sync/s3/settings">Settings</a> or
					<a class="link" href="/sync/s3/files">Beancount files</a>. The conflict can be resolved
					there too.
				</p>
				<div class="modal-action">
					<button class="btn btn-ghost" onclick={() => (overwriteDirection = null)}>Cancel</button>
					<button class="btn btn-warning" disabled={busy} onclick={confirmOverwrite}>
						{toBucket ? 'Overwrite bucket' : 'Overwrite this device'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if trusting}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="text-lg font-bold">
					{trusting.replaces ? 'Replace trusted device' : 'Trust device'}
				</h3>
				{#if trusting.replaces}
					<p class="py-2 text-sm">
						This device says it is <strong>{trusting.replaces.name}</strong>, which you trust
						already, and has a new identity. If the name and fingerprint below are right, trusting
						it replaces that record.
					</p>
				{:else}
					<p class="py-2 text-sm">
						Records from this device will be merged into your local transactions.
					</p>
				{/if}
				<p class="pb-2 text-sm">
					<span class="flex items-baseline">
						<DeviceLabel
							name={trusting.announcedName ?? trusting.name ?? 'Unnamed device'}
							fingerprint={trusting.fingerprint}
						/>
					</span>
					{#if !trusting.publicKey}
						<span class="text-base-content/60 text-xs">
							This device has not published its key (an older app version), so it cannot be checked.
						</span>
					{/if}
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
			<p class="py-3 text-sm">
				The bucket has newer data for {statusRows.find((r) => r.key === overwriteItem)?.label} that this
				device has not downloaded.
			</p>
			<p class="py-3 text-sm text-base-content/70">
				Uploading may overwrite it. Download first to avoid losing changes.
			</p>
			<div class="modal-action">
				<form method="dialog" class="flex gap-2">
					<button class="btn btn-ghost">Cancel</button>
					<button
						class="btn btn-error"
						onclick={() => overwriteItem && run('upload', overwriteItem)}>Upload anyway</button
					>
				</form>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop"><button aria-label="Close">close</button></form>
	</dialog>
</main>
