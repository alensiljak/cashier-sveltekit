<script lang="ts">
	import { onMount, untrack, type Component, type Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
	import CloudIcon from '@lucide/svelte/icons/cloud';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import UsersIcon from '@lucide/svelte/icons/users';
	import CashierCardTemplate from './CashierCardTemplate.svelte';
	import DeviceLabel from './DeviceLabel.svelte';
	import { peerConnection } from '#lib/sync/peerConnection.svelte';
	import Notifier from '#lib/utils/notifier';
	import { syncOptions } from '#lib/services/syncOptions.svelte';
	import { syncHub } from '#lib/sync/hub';
	import { checkWithNotice, syncWithNotice } from '#lib/sync/hubActions';
	import type { ChannelStatus as Status } from '#lib/sync/channel';

	const presence = peerConnection.presence;

	// WebDAV and S3 go through the shared Sync hub, so the card and the /sync page show the same
	// cached status. The peer row has its own per-device comparison below.
	const webdavSnap = $derived(syncHub.snapshotOf('webdav'));
	const s3Snap = $derived(syncHub.snapshotOf('s3'));

	let connecting = $state(false);

	let noOptions = $derived(
		syncOptions.loaded && !syncOptions.webdav && !syncOptions.s3 && !syncOptions.peer
	);

	// --- peers ---

	let trustedPeers = $derived(presence.activePeerList.filter((p) => p.isTrusted));

	// The peer channel goes through the hub too. Its check reads each trusted device's hash, which
	// is cheap, so it runs as soon as a trusted device appears (the other channels wait for you).
	const peerSnap = $derived(syncHub.snapshotOf('peer'));
	const peerReady = $derived(presence.isInRoom && trustedPeers.length > 0);

	$effect(() => {
		const key = trustedPeers.map((p) => p.trysteroId).join(',');
		if (key) untrack(() => void syncHub.check('peer'));
	});

	/** Only meaningful while a trusted device is reachable; after that the old result is stale. */
	const peerStatus = $derived<Status>(peerReady ? peerSnap.status : 'unchecked');
	const peerStatusOf = (id: string) => peerSnap.peers?.find((p) => p.id === id)?.status;
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

	// --- WebDAV and S3 ---

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

{#snippet peerSwitch()}
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
{/snippet}

{#snippet targetRow(
	Icon: Component<{ size?: number }>,
	label: string,
	href: string,
	status: Status,
	busy: boolean,
	onCheck: () => void,
	onSync: () => void,
	canAct: boolean = true,
	afterLabel?: Snippet
)}
	<div class="flex items-center gap-3">
		<button
			type="button"
			class="flex min-w-0 items-center gap-2 text-left"
			onclick={() => goto(href)}
		>
			<Icon size={20} />
			<span class="truncate text-base">{label}</span>
		</button>
		{@render afterLabel?.()}
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
		<span class="grow"></span>
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
						'/sync/webdav',
						webdavSnap.status,
						webdavSnap.busy,
						() => checkWithNotice('webdav', 'WebDAV'),
						() => syncWithNotice('webdav', 'WebDAV')
					)}
				{/if}
				{#if syncOptions.s3}
					{@render targetRow(
						DatabaseIcon,
						'S3',
						'/sync/s3',
						s3Snap.status,
						s3Snap.busy,
						() => checkWithNotice('s3', 'S3'),
						() => syncWithNotice('s3', 'S3')
					)}
				{/if}
				{#if syncOptions.peer}
					<div>
						{@render targetRow(
							UsersIcon,
							'P2P',
							'/sync/peer',
							peerStatus,
							peerSnap.busy,
							() => checkWithNotice('peer', 'P2P'),
							() => syncWithNotice('peer', 'P2P'),
							peerReady,
							peerSwitch
						)}
						<div class="pl-8 text-sm opacity-70">
							{#if !presence.isInRoom}
								Peer sync is off.
							{:else if presence.activePeerList.length === 0}
								Looking for other devices…
							{:else}
								{#each presence.activePeerList as peer (peer.trysteroId)}
									<div class="flex items-center gap-2">
										<span class="flex grow items-baseline overflow-hidden"
											><DeviceLabel name={peer.name} fingerprint={peer.fingerprint} /></span
										>
										{#if !peer.isTrusted}
											<span class="badge badge-ghost badge-sm">Not paired</span>
										{:else if peerStatusOf(peer.trysteroId) === 'differs'}
											<span class="badge badge-warning badge-sm">Changes</span>
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
