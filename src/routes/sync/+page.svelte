<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import CloudIcon from '@lucide/svelte/icons/cloud';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import UsersIcon from '@lucide/svelte/icons/users';
	import FileDownIcon from '@lucide/svelte/icons/file-down';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import { syncOptions } from '#lib/services/syncOptions.svelte';
	import { peerConnection } from '#lib/sync/peerConnection.svelte';
	import { syncHub } from '#lib/sync/hub';
	import { checkWithNotice, syncWithNotice } from '#lib/sync/hubActions';
	import { formatAge, hasFileChanges, type ChannelId, type ChannelStatus } from '#lib/sync/channel';

	const icons: Record<ChannelId, Component<{ size?: number }>> = {
		webdav: CloudIcon,
		s3: DatabaseIcon,
		peer: UsersIcon
	};

	const statusBadge: Record<ChannelStatus, { text: string; cls: string }> = {
		unchecked: { text: 'Not checked', cls: 'badge-ghost' },
		checking: { text: 'Checking…', cls: 'badge-ghost' },
		same: { text: 'In sync', cls: 'badge-success' },
		differs: { text: 'Changes to sync', cls: 'badge-warning' },
		error: { text: 'Failed', cls: 'badge-error' }
	};

	// For "x minutes ago"; refreshed while the page is open.
	let now = $state(new Date());

	// Only local reads here: opening the page contacts no channel. Checking is up to the user.
	onMount(() => {
		if (!syncOptions.loaded) void syncOptions.load();
		void syncHub.load();
		if (syncOptions.peer) void peerConnection.ensureInit();
		const timer = setInterval(() => (now = new Date()), 30_000);
		return () => clearInterval(timer);
	});

	const checkable = $derived(syncHub.enabled.filter((c) => !c.unavailableReason()));
	const anyBusy = $derived(
		syncHub.enabled.some((c) => {
			const s = syncHub.snapshotOf(c.id);
			return s.busy || s.status === 'checking';
		})
	);

	// A stored value outside the list (set elsewhere) is still offered, so the select shows it.
	const staleChoices = $derived(
		[...new Set([1, 3, 7, 14, 30, syncHub.staleDays])].sort((a, b) => a - b)
	);

	const overall = $derived(syncHub.overall);
	const newest = $derived(syncHub.newestSync);
</script>

<main class="flex h-full flex-col">
	<Toolbar title="Sync" />

	<section class="mx-auto w-full max-w-2xl flex-1 touch-pan-y space-y-4 overflow-y-auto p-4">
		<!-- Overall state -->
		{#if overall === 'none'}
			<div class="alert alert-info text-sm" role="status">
				<span>
					No sync options selected. Choose them in
					<a class="link" href="/settings#backup-sync">Settings → Backup &amp; Sync</a>.
				</span>
			</div>
		{:else if overall === 'error'}
			<div class="alert alert-error text-sm" role="status">
				<span>A check or sync failed. See below.</span>
			</div>
		{:else if overall === 'attention'}
			<div class="alert alert-warning text-sm" role="status">
				<span>Some channels have changes to exchange.</span>
			</div>
		{:else if overall === 'stale'}
			<div class="alert alert-warning text-sm" role="status">
				<span>
					{newest
						? `Your data was last synced ${formatAge(newest, now)}.`
						: 'No sync has been recorded on this device, or its status is not checked yet.'}
					Check a channel below to see where you stand.
				</span>
			</div>
		{:else}
			<div class="alert alert-success text-sm" role="status">
				<span>
					Up to date{newest ? ` — last synced ${formatAge(newest, now)}` : ''}.
				</span>
			</div>
		{/if}

		<!-- Channels -->
		{#if syncHub.enabled.length > 0}
			<div class="flex items-center gap-2">
				<h2 class="flex-1 text-lg font-semibold">Channels</h2>
				<button
					type="button"
					class="btn btn-sm btn-neutral"
					disabled={checkable.length === 0 || anyBusy}
					onclick={() => syncHub.checkAll()}
					title="Contacts every channel that is reachable now"
				>
					<RotateCwIcon size={16} />
					Check all
				</button>
			</div>

			<ul class="space-y-3">
				{#each syncHub.enabled as channel (channel.id)}
					{@const snap = syncHub.snapshotOf(channel.id)}
					{@const reason = channel.unavailableReason()}
					{@const Icon = icons[channel.id]}
					<li class="rounded-box bg-base-200 space-y-2 p-3" data-testid="channel-{channel.id}">
						<div class="flex items-center gap-2">
							<Icon size={20} />
							<a class="flex-1 text-base font-semibold" href={channel.href}>{channel.label}</a>
							{#if snap.status === 'checking'}
								<span class="loading loading-spinner loading-xs"></span>
							{/if}
							<span class="badge badge-sm {statusBadge[snap.status].cls}">
								{statusBadge[snap.status].text}
							</span>
						</div>

						<div class="space-y-0.5 text-xs opacity-70">
							<p>
								Last sync: {snap.lastSync
									? `${formatAge(snap.lastSync, now)} (${snap.lastSync.toLocaleString()})`
									: 'never recorded'}
							</p>
							{#if snap.checkedAt}
								<p>Checked {formatAge(snap.checkedAt, now)}</p>
							{/if}
						</div>

						{#if snap.status === 'differs' && snap.pending}
							<p class="text-sm" data-testid="pending-{channel.id}">
								{#if snap.pending.upload && snap.pending.download}
									This device and {channel.label} each have changes the other lacks.
								{:else if snap.pending.upload}
									This device has changes {channel.label} lacks.
								{:else if snap.pending.download}
									{channel.label} has changes this device lacks.
								{/if}
							</p>
						{/if}

						{#if snap.pending?.files && hasFileChanges(snap.pending.files)}
							{@const f = snap.pending.files}
							<p class="text-sm" data-testid="files-{channel.id}">
								Beancount files and settings:
								{[
									f.upload ? `${f.upload} to upload` : '',
									f.download ? `${f.download} to download` : '',
									f.conflict ? `${f.conflict} to review` : ''
								]
									.filter(Boolean)
									.join(', ')}.
								<a class="link" href={channel.href}>Review</a>
							</p>
						{/if}

						{#if snap.peers && snap.peers.length > 0}
							<ul class="space-y-1 text-sm" data-testid="peers-{channel.id}">
								{#each snap.peers as peer (peer.id)}
									<li class="flex items-center gap-2">
										<span class="min-w-0 flex-1 truncate">{peer.name}</span>
										{#if peer.files && peer.files.pull + peer.files.conflict > 0}
											<a
												class="link text-xs"
												data-testid="peer-files-{peer.id}"
												href="/sync/beancount?peer={peer.persistentId}"
											>
												{[
													peer.files.pull ? `${peer.files.pull} to pull` : '',
													peer.files.conflict ? `${peer.files.conflict} to review` : ''
												]
													.filter(Boolean)
													.join(', ')}
											</a>
										{/if}
										<span
											class="badge badge-sm {peer.status === 'same'
												? 'badge-success'
												: peer.status === 'differs'
													? 'badge-warning'
													: 'badge-ghost'}"
										>
											{peer.status === 'same'
												? 'In sync'
												: peer.status === 'differs'
													? 'Changes to sync'
													: 'No answer'}
										</span>
									</li>
								{/each}
							</ul>
						{/if}

						{#if snap.status === 'error' && snap.error}
							<p class="text-error text-sm">{snap.error}</p>
						{:else if reason}
							<p class="text-sm opacity-70">{reason}</p>
						{/if}

						<div class="flex items-center gap-2">
							<button
								type="button"
								class="btn btn-sm btn-neutral"
								disabled={!!reason || snap.busy || snap.status === 'checking'}
								onclick={() => checkWithNotice(channel.id, channel.label)}
							>
								<RotateCwIcon size={16} />
								Check
							</button>
							<button
								type="button"
								class="btn btn-sm {snap.status === 'differs' ? 'btn-warning' : 'btn-neutral'}"
								disabled={!!reason || snap.busy || snap.status === 'checking'}
								onclick={() => syncWithNotice(channel.id, channel.label)}
							>
								<ArrowLeftRightIcon size={16} class={snap.busy ? 'animate-pulse' : ''} />
								Sync now
							</button>
							<span class="flex-1"></span>
							<a class="btn btn-sm btn-ghost" href={channel.href}>
								Details <ChevronRightIcon size={14} />
							</a>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<label class="flex items-center gap-2 text-sm">
			<span class="flex-1">Warn when nothing has synced for</span>
			<select
				class="select select-sm w-28"
				data-testid="stale-days"
				value={String(syncHub.staleDays)}
				onchange={(e) => syncHub.setStaleDays(Number(e.currentTarget.value))}
			>
				{#each staleChoices as days (days)}
					<option value={String(days)}>{days === 1 ? '1 day' : `${days} days`}</option>
				{/each}
			</select>
		</label>

		<!-- Other ways to move data -->
		<h2 class="pt-2 text-lg font-semibold">More</h2>
		<ul class="space-y-2">
			<li>
				<a class="rounded-box bg-base-200 flex items-center gap-3 p-3" href="/sync/backup-file">
					<FileDownIcon size={20} />
					<span class="min-w-0 flex-1">
						<span class="block text-base font-semibold">Backup file</span>
						<span class="block text-xs opacity-70">
							Export or restore everything as a file, with no sync service.
						</span>
					</span>
					<ChevronRightIcon size={16} />
				</a>
			</li>
			<li>
				<a class="rounded-box bg-base-200 flex items-center gap-3 p-3" href="/settings#backup-sync">
					<Settings2Icon size={20} />
					<span class="min-w-0 flex-1">
						<span class="block text-base font-semibold">Sync options</span>
						<span class="block text-xs opacity-70">Choose which channels you use.</span>
					</span>
					<ChevronRightIcon size={16} />
				</a>
			</li>
		</ul>
	</section>
</main>
