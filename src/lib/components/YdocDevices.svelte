<script lang="ts">
	import { onMount } from 'svelte';
	import { RefreshCwIcon, Trash2Icon, UserCheckIcon } from '@lucide/svelte';
	import Notifier from '$lib/utils/notifier';
	import { WebDavClient } from '$lib/utils/webdav';
	import { getXactStore } from '$lib/storage/xactStoreRegistry';
	import { getReadyScxStore } from '$lib/services/scxService';
	import {
		describeScxChanges,
		summarizeScxReport,
		type ScxMergeReport
	} from '$lib/services/scxMergeReport';
	import {
		listRemoteDevices,
		trustDevice,
		getMergeState,
		setMergeState,
		needsMerge,
		type DocKind,
		type MergeState,
		type RemoteDevice
	} from '$lib/sync/ydocDevices';

	interface Props {
		url: string;
		username: string;
		password: string;
		/** Called after remote records were merged into the local document. */
		onmerged?: () => void;
	}

	let { url, username, password, onmerged }: Props = $props();

	let devices = $state<RemoteDevice[]>([]);
	let mergeState = $state<Record<string, MergeState>>({});
	let counts = $state<Record<string, number>>({});
	let isLoading = $state(false);
	let error = $state('');
	let deleting = $state<RemoteDevice | null>(null);
	let trusting = $state<RemoteDevice | null>(null);
	let trustName = $state('');

	const mergeable = $derived(
		devices.filter(
			(d) =>
				d.status === 'trusted' &&
				!d.readOnly &&
				(needsMerge(d, mergeState[d.deviceId]) || needsMerge(d, mergeState[d.deviceId], 'scx'))
		)
	);

	function client() {
		return new WebDavClient(url, username, password);
	}

	export async function refresh() {
		if (!url) return;
		isLoading = true;
		error = '';
		try {
			devices = await listRemoteDevices(client());
			mergeState = await getMergeState();
			counts = await (await getXactStore()).originCounts();
		} catch (err) {
			error = (err as Error).message;
		} finally {
			isLoading = false;
		}
	}

	onMount(refresh);

	/**
	 * Merge every trusted device's file of the given kinds that changed since the
	 * last merge. The scheduled-transactions merge is reported once, in a message.
	 */
	export async function mergeTrusted(kinds: DocKind[] = ['xacts', 'scx']) {
		const dav = client();
		let xactDevices = 0;
		let scxDevices = 0;
		const scxReport: ScxMergeReport = { added: 0, changed: 0, deleted: 0, lines: [] };
		try {
			for (const d of mergeable) {
				const who = d.name ?? d.deviceId;
				try {
					if (kinds.includes('xacts') && needsMerge(d, mergeState[d.deviceId])) {
						const res = await dav.get(d.filename);
						if (!res.ok) {
							Notifier.error(`Download failed for ${d.filename}: ${res.status} ${res.statusText}`);
						} else {
							await (await getXactStore()).importState(new Uint8Array(await res.arrayBuffer()));
							await setMergeState(d.deviceId, {
								remoteTs: d.lastModified?.toISOString() ?? null,
								mergedAt: new Date().toISOString()
							});
							xactDevices++;
						}
					}
					if (kinds.includes('scx') && d.scx && needsMerge(d, mergeState[d.deviceId], 'scx')) {
						const res = await dav.get(d.scx.filename);
						if (!res.ok) {
							Notifier.error(
								`Download failed for ${d.scx.filename}: ${res.status} ${res.statusText}`
							);
						} else {
							const store = await getReadyScxStore();
							const part = describeScxChanges(
								await store.importState(new Uint8Array(await res.arrayBuffer()))
							);
							scxReport.added += part.added;
							scxReport.changed += part.changed;
							scxReport.deleted += part.deleted;
							scxReport.lines.push(...part.lines);
							await setMergeState(d.deviceId, {
								scxTs: d.scx.lastModified?.toISOString() ?? null,
								mergedAt: new Date().toISOString()
							});
							scxDevices++;
						}
					}
				} catch (err) {
					Notifier.error(`Merge failed for ${who}: ${(err as Error).message}`);
				}
			}
			if (xactDevices > 0) {
				Notifier.success(`Merged ${xactDevices} device${xactDevices === 1 ? '' : 's'}`);
				onmerged?.();
			}
			if (scxDevices > 0) {
				Notifier.success(
					`Scheduled transactions merged from ${scxDevices} device${scxDevices === 1 ? '' : 's'}: ${summarizeScxReport(scxReport)}`
				);
			}
		} finally {
			await refresh();
		}
	}
	function startTrust(d: RemoteDevice) {
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
			const res = await client().delete(d.filename);
			if (res.ok || res.status === 404) Notifier.success(`${d.filename} deleted`);
			else Notifier.error(`Delete failed: ${res.status} ${res.statusText}`);
		} catch (err) {
			Notifier.error('Delete error: ' + (err as Error).message);
		}
		await refresh();
	}

	function label(d: RemoteDevice): string {
		if (d.status === 'self') return 'This device';
		return d.name ?? `Device ${d.deviceId.slice(0, 6)}`;
	}

	function recordCount(d: RemoteDevice): number {
		return counts[d.deviceId] ?? 0;
	}
</script>

<div class="flex flex-col gap-3">
		<div class="flex items-center justify-between">
			<h3 class="text-sm font-medium text-base-content/60">Files from all devices</h3>
			{#if isLoading}
				<RefreshCwIcon size={14} class="animate-spin text-base-content/40" />
			{:else}
				<button
					class="text-xs text-base-content/40 hover:text-base-content/70 flex items-center gap-1 cursor-pointer"
					disabled={!url}
					onclick={refresh}
				>
					<RefreshCwIcon size={12} />
					refresh
				</button>
			{/if}
		</div>

		{#if error}
			<p class="text-xs text-error">{error}</p>
		{:else if devices.length === 0 && !isLoading}
			<p class="text-xs text-base-content/50">No device files found on WebDAV.</p>
		{/if}

		<ul class="flex flex-col gap-3">
			{#each devices as d (d.deviceId)}
				{@const state = mergeState[d.deviceId]}
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
							{#if d.status === 'self'}
								· {recordCount(d)} own records
							{:else if d.status === 'trusted'}
								· {state ? `merged ${new Date(state.mergedAt).toLocaleString()}` : 'never merged'}
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
					<button
						class="btn btn-xs btn-ghost text-error"
						title="Delete file from WebDAV"
						aria-label="Delete {d.filename}"
						onclick={() => (deleting = d)}
					>
						<Trash2Icon size={14} />
					</button>
				</li>
			{/each}
		</ul>
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
			<h3 class="font-bold text-lg">Delete file</h3>
			<p class="py-4 text-sm">
				<strong>{deleting.filename}</strong> will be removed from WebDAV.
				{#if deleting.status === 'self'}
					This is <strong>this device's</strong> file; it is re-created on the next upload.
				{:else}
					Records already merged into this device stay here.
				{/if}
			</p>
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={() => (deleting = null)}>Cancel</button>
				<button class="btn btn-error" onclick={confirmDelete}>Delete</button>
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => (deleting = null)}></button>
	</div>
{/if}
