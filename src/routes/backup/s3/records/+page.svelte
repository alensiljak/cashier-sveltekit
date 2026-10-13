<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ArrowDownIcon, ArrowUpIcon, RefreshCwIcon } from '@lucide/svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import { isS3Configured, loadS3Config, type S3Config } from '#lib/services/s3Config';
	import { describeS3Error } from '#lib/services/s3Client';
	import { describeRecord, fieldDiffs } from '#lib/services/crdtRecordDiff';
	import { previewCrdtChanges, type CrdtChangePreview, type CrdtRecord } from '#lib/services/s3Sync';
	import type { RecordChange } from '#lib/storage/crdtDocStore';

	type Item = 'xacts' | 'scheduled';
	const items: { key: Item; label: string }[] = [
		{ key: 'xacts', label: 'Local Transactions' },
		{ key: 'scheduled', label: 'Scheduled Transactions' }
	];

	let cfg = $state<S3Config | null>(null);
	let item = $state<Item>('xacts');
	let preview = $state<CrdtChangePreview | null>(null);
	let loading = $state(false);
	let loadError = $state<string | null>(null);

	async function refresh() {
		if (!cfg) return;
		loading = true;
		loadError = null;
		preview = null;
		try {
			preview = await previewCrdtChanges(cfg, item);
		} catch (e) {
			loadError = e instanceof Error ? e.message : describeS3Error(e);
		} finally {
			loading = false;
		}
	}

	function select(next: Item) {
		item = next;
		void refresh();
	}

	onMount(async () => {
		const saved = await loadS3Config();
		if (!isS3Configured(saved)) {
			await goto('/settings/s3-cfg', { replace: true });
			return;
		}
		cfg = saved;
		if (!saved.passphrase) {
			loadError = 'Set an encryption passphrase in the S3 configuration first.';
			return;
		}
		await refresh();
	});

	const actionClass = { add: 'badge-success', update: 'badge-warning', delete: 'badge-error' };
	const label = (c: RecordChange<CrdtRecord>) => describeRecord(c.after ?? c.before) || c.id;
</script>

{#snippet change(c: RecordChange<CrdtRecord>)}
	<li class="bg-base-300 rounded-box p-2 text-sm">
		<div class="flex items-center gap-2">
			<span class="badge badge-sm badge-soft {actionClass[c.action]}">{c.action}</span>
			<span class="min-w-0 flex-1 truncate">{label(c)}</span>
		</div>
		<dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-2 font-mono text-xs">
			{#each fieldDiffs(c.before, c.after) as f (f.field)}
				<dt class="text-base-content/60">{f.field}</dt>
				<dd class="break-all">
					{#if f.before !== undefined}<span class="text-error line-through">{f.before}</span>{/if}
					{#if f.before !== undefined && f.after !== undefined}
						→
					{/if}
					{#if f.after !== undefined}<span class="text-success">{f.after}</span>{/if}
				</dd>
			{/each}
		</dl>
	</li>
{/snippet}

<main class="flex h-screen flex-col">
	<Toolbar title="Review Records">
		{#snippet actions()}
			<button
				class="btn btn-ghost btn-sm btn-square"
				aria-label="Refresh"
				disabled={loading}
				onclick={refresh}
			>
				<RefreshCwIcon size={20} class={loading ? 'animate-spin' : ''} />
			</button>
		{/snippet}
	</Toolbar>
	<section class="flex-1 space-y-3 overflow-y-auto touch-pan-y p-4">
		<div class="mx-auto max-w-2xl space-y-3">
			<div role="tablist" class="tabs tabs-box">
				{#each items as i (i.key)}
					<button
						role="tab"
						class="tab {item === i.key ? 'tab-active' : ''}"
						onclick={() => select(i.key)}>{i.label}</button
					>
				{/each}
			</div>
			<p class="text-xs text-base-content/60">
				A preview only: nothing is downloaded, uploaded or merged here. "Old → new" is the record
				as it is now, and as it would be afterwards.
			</p>

			{#if loadError}
				<p class="text-sm text-error">{loadError}</p>
			{:else if loading}
				<span class="loading loading-spinner"></span>
			{:else if preview}
				<div class="card bg-base-200 shadow-sm">
					<div class="card-body gap-2 p-4">
						<h2 class="card-title text-sm">
							<ArrowDownIcon size={16} /> Download: changes on this device
						</h2>
						{#each preview.download as d (d.key)}
							<h3 class="text-xs font-semibold">
								{d.name ?? `Device ${d.deviceId?.slice(0, 6)}`}
								{#if d.ignored}<span class="badge badge-neutral badge-sm">{d.ignored}</span>{/if}
							</h3>
							{#if !d.ignored}
								{#if d.changes.length}
									<ul class="space-y-2">
										{#each d.changes as c (c.id)}{@render change(c)}{/each}
									</ul>
								{:else}
									<p class="text-xs text-base-content/60">Nothing new.</p>
								{/if}
							{/if}
						{:else}
							<p class="text-xs text-base-content/60">No other device has uploaded yet.</p>
						{/each}
					</div>
				</div>

				<div class="card bg-base-200 shadow-sm">
					<div class="card-body gap-2 p-4">
						<h2 class="card-title text-sm">
							<ArrowUpIcon size={16} /> Upload: changes for other devices
						</h2>
						{#if preview.upload.length}
							<ul class="space-y-2">
								{#each preview.upload as c (c.id)}{@render change(c)}{/each}
							</ul>
						{:else}
							<p class="text-xs text-base-content/60">Nothing new.</p>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</section>
</main>
