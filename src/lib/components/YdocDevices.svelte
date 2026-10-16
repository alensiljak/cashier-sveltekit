<script lang="ts">
	import { onMount } from 'svelte';
	import { PackageIcon, RefreshCwIcon, Trash2Icon, UserCheckIcon } from '@lucide/svelte';
	import Notifier from '#lib/utils/notifier';
	import { WebDavClient } from '#lib/utils/webdav';
	import { getXactStore } from '#lib/storage/xactStoreRegistry';
	import { getReadyScxStore } from '#lib/services/scxService';
	import { describeScxChanges, summarizeScxReport } from '#lib/services/scxMergeReport';
	import {
		compactWebDavNow,
		forgetWebDavDevice,
		listWebDavDevices,
		mergeWebDav,
		type WebDavDevice
	} from '#lib/services/webdavDelta';
	import { trustDevice, type DocKind } from '#lib/sync/ydocDevices';
	import type { RecordChange } from '#lib/storage/crdtDocStore';
	import type { ScxRecord } from '#lib/storage/crdtScxRecord';

	interface Props {
		url: string;
		username: string;
		password: string;
		/** Called after remote records were merged into the local document. */
		onmerged?: () => void;
	}

	let { url, username, password, onmerged }: Props = $props();

	let devices = $state<WebDavDevice[]>([]);
	let counts = $state<Record<string, number>>({});
	let isLoading = $state(false);
	let isCompacting = $state(false);
	let error = $state('');
	let deleting = $state<WebDavDevice | null>(null);
	let trusting = $state<WebDavDevice | null>(null);
	let trustName = $state('');

	function client() {
		return new WebDavClient(url, username, password);
	}

	export async function refresh() {
		if (!url) return;
		isLoading = true;
		error = '';
		try {
			devices = await listWebDavDevices(client());
			counts = await (await getXactStore()).originCounts();
		} catch (err) {
			error = (err as Error).message;
		} finally {
			isLoading = false;
		}
	}

	onMount(refresh);

	/**
	 * Merges what the trusted devices uploaded to the folder, for the given kinds. The
	 * scheduled-transactions merge is reported once, in a message.
	 */
	export async function mergeTrusted(kinds: DocKind[] = ['xacts', 'scx']) {
		try {
			// Set up (and, on a first launch, migrate) the scheduled transactions before merging into them.
			if (kinds.includes('scx')) await getReadyScxStore();
			const results = await mergeWebDav(client(), kinds);

			for (const [kind, r] of Object.entries(results)) {
				if (r.declined) {
					Notifier.info(`Reset by another device not applied (${kind}); you will be asked again at the next sync`);
				}
				for (const e of r.errors) Notifier.error(`Merge failed for ${e.key}: ${e.message}`);
				for (const bad of r.invalid.slice(0, 5)) {
					Notifier.error(`Record ${bad.id} that came in is not valid (${bad.reason}) (${kind})`);
				}
				for (const g of r.gaps) {
					Notifier.error(
						`Delta ${g.expected} of ${g.deviceId} is missing from the folder; later changes are not merged yet (${kind})`
					);
				}
			}
			const xacts = results.xacts;
			if (xacts && (xacts.deltas || xacts.snapshot || xacts.legacy)) {
				Notifier.success(`Merged ${xacts.changes} change${xacts.changes === 1 ? '' : 's'}`);
				onmerged?.();
			}
			const scx = results.scx;
			if (scx && (scx.deltas || scx.snapshot || scx.legacy)) {
				const report = describeScxChanges(scx.records as RecordChange<ScxRecord>[]);
				Notifier.success(`Scheduled transactions merged: ${summarizeScxReport(report)}`);
			}
		} catch (err) {
			Notifier.error(`Merge failed: ${(err as Error).message}`);
		} finally {
			await refresh();
		}
	}

	/** Folds the deltas into a snapshot and deletes what that makes unnecessary. */
	async function compactNow() {
		isCompacting = true;
		try {
			const results = await compactWebDavNow(client());
			const deleted = Object.values(results).reduce((n, r) => n + (r?.deleted ?? 0), 0);
			const skipped = Object.values(results).find((r) => r?.skipped)?.skipped;
			if (skipped) Notifier.error(`Not compacted: ${skipped}`);
			else Notifier.success(deleted ? `Compacted: ${deleted} file(s) removed` : 'Nothing to compact');
		} catch (err) {
			Notifier.error('Compaction failed: ' + (err as Error).message);
		} finally {
			isCompacting = false;
			await refresh();
		}
	}

	function startTrust(d: WebDavDevice) {
		trusting = d;
		trustName = `Device ${d.deviceId.slice(0, 6)}`;
	}

	async function confirmTrust() {
		if (!trusting) return;
		await trustDevice(trusting.deviceId, trustName);
		trusting = null;
		await refresh();
	}

	async function confirmDelete() {
		if (!deleting) return;
		const d = deleting;
		deleting = null;
		try {
			const { deleted } = await forgetWebDavDevice(client(), d.deviceId);
			Notifier.success(`${deleted} file(s) of ${label(d)} deleted`);
		} catch (err) {
			Notifier.error('Delete error: ' + (err as Error).message);
		}
		await refresh();
	}

	function label(d: WebDavDevice): string {
		if (d.status === 'self') return 'This device';
		return d.name ?? `Device ${d.deviceId.slice(0, 6)}`;
	}

	function recordCount(d: WebDavDevice): number {
		return counts[d.deviceId] ?? 0;
	}
</script>

<div class="flex flex-col gap-3">
		<div class="flex items-center justify-between">
			<h3 class="text-sm font-medium text-base-content/60">Files from all devices</h3>
			{#if isLoading}
				<RefreshCwIcon size={14} class="animate-spin text-base-content/40" />
			{:else}
				<div class="flex items-center gap-3">
					<button
						class="text-xs text-base-content/40 hover:text-base-content/70 flex items-center gap-1 cursor-pointer"
						disabled={!url || isCompacting}
						title="Fold the uploaded changes into a snapshot and delete those every device has"
						onclick={compactNow}
					>
						<PackageIcon size={12} />
						{isCompacting ? 'compacting…' : 'compact now'}
					</button>
					<button
						class="text-xs text-base-content/40 hover:text-base-content/70 flex items-center gap-1 cursor-pointer"
						disabled={!url}
						onclick={refresh}
					>
						<RefreshCwIcon size={12} />
						refresh
					</button>
				</div>
			{/if}
		</div>

		{#if error}
			<p class="text-xs text-error">{error}</p>
		{:else if devices.length === 0 && !isLoading}
			<p class="text-xs text-base-content/50">No device files found on WebDAV.</p>
		{/if}

		<ul class="flex flex-col gap-3">
			{#each devices as d (d.deviceId)}
				<li class="flex items-center gap-2">
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2">
							<span class="font-medium truncate">{label(d)}</span>
							{#if d.status === 'trusted'}
								<span class="badge badge-success badge-sm">trusted</span>
								{#if d.readOnly}
									<span class="badge badge-neutral badge-sm">read-only</span>
								{/if}
							{:else if d.status === 'untrusted'}
								<span class="badge badge-warning badge-sm">not trusted</span>
							{/if}
						</div>
						<div class="text-xs text-base-content/50">
							{#if d.lastModified}Updated {d.lastModified.toLocaleString()}{/if}
							· {d.objects} file{d.objects === 1 ? '' : 's'}
							{#if d.status === 'self'}
								· {recordCount(d)} own records
							{:else if d.status === 'trusted'}
								· {recordCount(d)} records here
							{/if}
						</div>
					</div>
					{#if d.status === 'untrusted'}
						<button class="btn btn-xs btn-outline" onclick={() => startTrust(d)}>
							<UserCheckIcon size={12} />
							Trust
						</button>
					{/if}
					{#if d.status !== 'self'}
						<button
							class="btn btn-xs btn-ghost text-error"
							title="Delete this device's files from WebDAV"
							aria-label="Delete the files of {label(d)}"
							onclick={() => (deleting = d)}
						>
							<Trash2Icon size={14} />
						</button>
					{/if}
				</li>
			{/each}
		</ul>

		<a href="/settings/trusted-devices" class="link text-xs">Manage trusted devices</a>
</div>

{#if trusting}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">Trust device</h3>
			<p class="py-2 text-sm">
				Records from this device will be merged into your local transactions. ID:
				<code>{trusting.deviceId}</code>
			</p>
			<input class="input input-bordered w-full" bind:value={trustName} aria-label="Device name" />
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={() => (trusting = null)}>Cancel</button>
				<button class="btn btn-primary" onclick={confirmTrust}>Trust</button>
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => (trusting = null)}></button>
	</div>
{/if}

{#if deleting}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">Delete device files</h3>
			<p class="py-4 text-sm">
				All <strong>{deleting.objects}</strong> file{deleting.objects === 1 ? '' : 's'} of
				<strong>{label(deleting)}</strong> will be removed from WebDAV.
				{#if deleting.status === 'trusted'}
					What it uploaded is merged here first and kept for the other devices.
				{:else}
					It is not trusted, so what it uploaded is not merged.
				{/if}
				Records already merged into this device stay here.
			</p>
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={() => (deleting = null)}>Cancel</button>
				<button class="btn btn-error" onclick={confirmDelete}>Delete</button>
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => (deleting = null)}></button>
	</div>
{/if}
