<script lang="ts">
	import { onMount, untrack, type Component } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		ArrowLeftRightIcon,
		CloudIcon,
		DatabaseIcon,
		RefreshCwIcon,
		RotateCwIcon,
		Settings2Icon,
		UsersIcon
	} from '@lucide/svelte';
	import CashierCardTemplate from './CashierCardTemplate.svelte';
	import { peerConnection } from '$lib/sync/peerConnection.svelte';
	import { reloadLedgerFromOpfs } from '$lib/services/ledgerReload';
	import Notifier from '$lib/utils/notifier';
	import { syncOptions } from '$lib/services/syncOptions.svelte';
	import { isS3Configured, loadS3Config } from '$lib/services/s3Config';
	import { describeS3Error } from '$lib/services/s3Client';

	const presence = peerConnection.presence;

	/** unchecked = not compared yet; differs = there are changes to exchange. */
	type Status = 'unchecked' | 'checking' | 'same' | 'differs' | 'error';
	type Target = 'webdav' | 's3' | 'peer';

	let webdavStatus = $state<Status>('unchecked');
	let s3Status = $state<Status>('unchecked');
	let webdavBusy = $state(false);
	let s3Busy = $state(false);
	let connecting = $state(false);
	let syncing = $state(false);

	let noOptions = $derived(
		syncOptions.loaded && !syncOptions.webdav && !syncOptions.s3 && !syncOptions.peer
	);

	// --- peers ---

	let trustedPeers = $derived(presence.activePeerList.filter((p) => p.isTrusted));

	/** Per-peer comparison of Local Transactions, done as soon as a trusted peer appears. */
	type DiffState = 'checking' | 'same' | 'differs' | 'unknown';
	let diffs = $state<Record<string, DiffState>>({});

	async function checkPeer(id: string) {
		diffs[id] = 'checking';
		try {
			const [local, remote] = await Promise.all([
				peerConnection.getLocalYdocHash(),
				peerConnection.fetchRemoteYdocHash(id)
			]);
			diffs[id] = remote === null ? 'unknown' : local === remote ? 'same' : 'differs';
		} catch {
			diffs[id] = 'unknown';
		}
	}

	$effect(() => {
		const ids = trustedPeers.map((p) => p.trysteroId);
		untrack(() => {
			for (const id of ids) if (!(id in diffs)) void checkPeer(id);
			for (const id of Object.keys(diffs)) if (!ids.includes(id)) delete diffs[id];
		});
	});

	let peerStatus = $derived.by<Status>(() => {
		const states = trustedPeers.map((p) => diffs[p.trysteroId]);
		if (states.includes('checking')) return 'checking';
		if (states.includes('differs')) return 'differs';
		if (states.length && states.every((s) => s === 'same')) return 'same';
		return 'unchecked';
	});

	onMount(() => {
		if (!syncOptions.loaded) void syncOptions.load();
		return peerConnection.ensureInit();
	});

	async function toggleConnection() {
		connecting = true;
		try {
			if (presence.isInRoom) {
				await peerConnection.disconnect();
			} else {
				await peerConnection.connect();
			}
		} catch (e) {
			Notifier.error('Connection failed: ' + (e as Error).message);
		} finally {
			connecting = false;
		}
	}

	async function checkPeers() {
		await Promise.all(trustedPeers.map((p) => checkPeer(p.trysteroId)));
	}

	/** Merges Local Transactions with every trusted peer that is currently online. */
	async function syncPeers() {
		if (syncing || trustedPeers.length === 0) return;
		syncing = true;
		try {
			let changed = false;
			for (const peer of trustedPeers) {
				changed = (await peerConnection.syncYdoc(peer.trysteroId)) || changed;
			}
			await checkPeers();
			if (changed) await reloadLedgerFromOpfs();
			Notifier.success(changed ? 'Synced — new transactions received' : 'Already in sync');
		} catch (e) {
			Notifier.error('Sync failed: ' + (e as Error).message);
		} finally {
			syncing = false;
		}
	}

	// --- WebDAV and S3 ---

	const message = (e: unknown) => (e instanceof Error ? e.message : describeS3Error(e));

	async function checkWebDavTarget() {
		webdavStatus = 'checking';
		try {
			const { loadWebDavClient, checkWebDav } = await import('$lib/services/webdavSync');
			const client = await loadWebDavClient();
			if (!client) throw new Error('WebDAV is not configured');
			webdavStatus = (await checkWebDav(client)) ? 'differs' : 'same';
		} catch (e) {
			webdavStatus = 'error';
			Notifier.error('WebDAV check failed: ' + message(e));
		}
	}

	async function syncWebDavTarget() {
		webdavBusy = true;
		try {
			const { loadWebDavClient, syncWebDav } = await import('$lib/services/webdavSync');
			const client = await loadWebDavClient();
			if (!client) throw new Error('WebDAV is not configured');
			const { errors, merged } = await syncWebDav(client);
			if (merged) await reloadLedgerFromOpfs();
			if (errors.length) {
				webdavStatus = 'error';
				Notifier.error('WebDAV sync failed: ' + errors.join('; '));
			} else {
				webdavStatus = 'same';
				Notifier.success(merged ? 'WebDAV synced — new transactions received' : 'WebDAV synced');
			}
		} catch (e) {
			webdavStatus = 'error';
			Notifier.error('WebDAV sync failed: ' + message(e));
		} finally {
			webdavBusy = false;
		}
	}

	async function loadS3() {
		const cfg = await loadS3Config();
		if (!isS3Configured(cfg)) throw new Error('S3 is not configured');
		return cfg;
	}

	async function checkS3Target() {
		s3Status = 'checking';
		try {
			const { checkCrdtStores } = await import('$lib/services/s3Sync');
			s3Status = (await checkCrdtStores(await loadS3())) ? 'differs' : 'same';
		} catch (e) {
			s3Status = 'error';
			Notifier.error('S3 check failed: ' + message(e));
		}
	}

	async function syncS3Target() {
		s3Busy = true;
		try {
			const { syncCrdtStores } = await import('$lib/services/s3Sync');
			const { errors, merged } = await syncCrdtStores(await loadS3());
			if (merged) await reloadLedgerFromOpfs();
			if (errors.length) {
				s3Status = 'error';
				Notifier.error('S3 sync failed: ' + errors.map((l) => l.message).join('; '));
			} else {
				s3Status = 'same';
				Notifier.success(merged ? 'S3 synced — new transactions received' : 'S3 synced');
			}
		} catch (e) {
			s3Status = 'error';
			Notifier.error('S3 sync failed: ' + message(e));
		} finally {
			s3Busy = false;
		}
	}

	const dotClass: Record<Status, string> = {
		unchecked: 'bg-base-300',
		checking: '',
		same: 'bg-success',
		differs: 'bg-warning',
		error: 'bg-error'
	};
	const dotTitle: Record<Status, string> = {
		unchecked: 'Not checked yet',
		checking: 'Checking…',
		same: 'In sync',
		differs: 'Changes to sync',
		error: 'Check or sync failed'
	};
</script>

{#snippet targetRow(
	Icon: Component<{ size?: number }>,
	label: string,
	href: string,
	status: Status,
	busy: boolean,
	onCheck: () => void,
	onSync: () => void,
	canAct: boolean = true
)}
	<div class="flex items-center gap-3">
		<button
			type="button"
			class="flex min-w-0 grow items-center gap-2 text-left"
			onclick={() => goto(href)}
		>
			<Icon size={20} />
			<span class="truncate text-base">{label}</span>
			{#if status === 'checking'}
				<span class="loading loading-spinner loading-xs" title={dotTitle.checking}></span>
			{:else}
				<span
					class="inline-block h-3 w-3 shrink-0 rounded-full {dotClass[status]}"
					title={dotTitle[status]}
					role="img"
					aria-label={dotTitle[status]}
				></span>
			{/if}
		</button>
		<button
			type="button"
			class="btn btn-circle btn-neutral"
			title="Check for changes"
			aria-label="Check {label} for changes"
			disabled={!canAct || busy || status === 'checking'}
			onclick={onCheck}
		>
			<RotateCwIcon size={20} />
		</button>
		<button
			type="button"
			class="btn btn-circle {status === 'differs' ? 'btn-warning' : 'btn-neutral'}"
			title="Sync now"
			aria-label="Sync {label}"
			disabled={!canAct || busy || status === 'checking'}
			onclick={onSync}
		>
			<ArrowLeftRightIcon size={20} class={busy ? 'animate-pulse' : ''} />
		</button>
	</div>
{/snippet}

<CashierCardTemplate>
	{#snippet icon()}
		<RefreshCwIcon />
	{/snippet}
	{#snippet title()}
		Sync
	{/snippet}
	{#snippet menu()}
		<a href="/settings#backup-sync" aria-label="Sync settings" title="Sync settings">
			<Settings2Icon />
		</a>
	{/snippet}
	{#snippet content()}
		{#if noOptions}
			<p class="text-sm opacity-60">
				No sync options selected. Choose them in Settings → Backup &amp; Sync.
			</p>
		{:else}
			<div class="space-y-3 px-2">
				{#if syncOptions.webdav}
					{@render targetRow(
						CloudIcon,
						'WebDAV',
						'/backup/webdav',
						webdavStatus,
						webdavBusy,
						checkWebDavTarget,
						syncWebDavTarget
					)}
				{/if}
				{#if syncOptions.s3}
					{@render targetRow(
						DatabaseIcon,
						'S3',
						'/backup/s3',
						s3Status,
						s3Busy,
						checkS3Target,
						syncS3Target
					)}
				{/if}
				{#if syncOptions.peer}
					<div>
						<div class="flex items-center gap-2">
							{#if connecting}
								<span class="loading loading-spinner loading-sm"></span>
							{:else}
								<input
									type="checkbox"
									class="toggle toggle-success toggle-sm bg-transparent bg-none"
									checked={presence.isInRoom}
									aria-label={presence.isInRoom ? 'Disconnect peer sync' : 'Connect peer sync'}
									onchange={toggleConnection}
								/>
							{/if}
							<div class="grow">
								{@render targetRow(
									UsersIcon,
									'Peers',
									'/peer-sync',
									peerStatus,
									syncing,
									checkPeers,
									syncPeers,
									presence.isInRoom && trustedPeers.length > 0
								)}
							</div>
						</div>
						<div class="pl-12 text-sm opacity-70">
							{#if !presence.isInRoom}
								Peer sync is off.
							{:else if presence.activePeerList.length === 0}
								Looking for other devices…
							{:else}
								{#each presence.activePeerList as peer (peer.trysteroId)}
									<div class="flex items-center gap-2">
										<span class="grow truncate">{peer.name}</span>
										{#if !peer.isTrusted}
											<span class="badge badge-ghost badge-sm">Not paired</span>
										{/if}
									</div>
								{/each}
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	{/snippet}
</CashierCardTemplate>
