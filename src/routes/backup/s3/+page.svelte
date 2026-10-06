<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { isS3Configured, loadS3Config, type S3Config } from '$lib/services/s3Config';
	import { describeS3Error } from '$lib/services/s3Client';
	import type { SyncDirection } from '$lib/services/s3SyncPlan';
	import {
		applyDeletion,
		openSession,
		resolveConflict,
		runSync,
		type S3Session,
		type SyncItem,
		type SyncLine
	} from '$lib/services/s3Sync';
	import { reloadLedgerFromOpfs } from '$lib/services/ledgerReload';
	import Notifier from '$lib/utils/notifier';
	import { SettingsIcon } from '@lucide/svelte';

	let cfg = $state<S3Config | null>(null);
	let ready = $state(false);

	let includeSettings = $state(false);
	let includeScheduled = $state(false);
	let includeXacts = $state(false);
	let includeBeancount = $state(false);

	const allSelected = $derived(
		includeSettings && includeScheduled && includeXacts && includeBeancount
	);
	const someSelected = $derived(
		includeSettings || includeScheduled || includeXacts || includeBeancount
	);
	let indeterminate = $state(false);
	$effect(() => {
		indeterminate = someSelected && !allSelected;
	});

	function toggleSelectAll() {
		const next = !allSelected;
		includeSettings = includeScheduled = includeXacts = includeBeancount = next;
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
		const items: SyncItem[] = [];
		if (includeSettings) items.push('settings');
		if (includeScheduled) items.push('scheduled');
		if (includeXacts) items.push('xacts');
		if (includeBeancount) items.push('beancount');
		return items;
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
			lines = await runSync(session, direction, selectedItems());
			reloadIfNeeded(lines);
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
			await goto('/settings/s3-cfg', { replaceState: true });
			return;
		}
		cfg = saved;
		ready = true;
	});
</script>

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
			<div class="mx-auto max-w-2xl space-y-4">
				<section class="text-sm">
					<span class="font-mono text-xs text-base-content/60">
						{cfg.bucket}{cfg.prefix ? '/' + cfg.prefix : ''}
					</span>
				</section>

				<section class="my-4">
					<h2 class="mb-3 text-lg font-semibold">Items</h2>
					<div class="flex flex-col gap-3">
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
						<label class="flex cursor-pointer items-center gap-3">
							<input type="checkbox" class="checkbox checkbox-primary" bind:checked={includeSettings} />
							<span class="flex-1">Settings</span>
						</label>
						<label class="flex cursor-pointer items-center gap-3">
							<input type="checkbox" class="checkbox checkbox-primary" bind:checked={includeScheduled} />
							<span class="flex-1">Scheduled Transactions</span>
						</label>
						<label class="flex cursor-pointer items-center gap-3">
							<input type="checkbox" class="checkbox checkbox-primary" bind:checked={includeXacts} />
							<span class="flex-1">Local Transactions</span>
						</label>
						<label class="flex cursor-pointer items-center gap-3">
							<input type="checkbox" class="checkbox checkbox-primary" bind:checked={includeBeancount} />
							<span class="flex-1">Beancount Files</span>
						</label>
					</div>
				</section>

				<section class="flex justify-center gap-3">
					<button
						class="btn btn-primary"
						disabled={!someSelected || busy}
						onclick={() => run('upload')}
					>
						{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
						Upload
					</button>
					<button
						class="btn btn-outline btn-error"
						disabled={!someSelected || busy}
						onclick={() => run('download')}
					>
						Download
					</button>
				</section>

				{#if !cfg.passphrase}
					<p class="text-center text-sm text-warning">
						Set an encryption passphrase in the
						<a href="/settings/s3-cfg" class="link">configuration</a> first.
					</p>
				{/if}

				{#if lines.length}
					<section class="space-y-2">
						<h2 class="text-lg font-semibold">Result</h2>
						<p class="text-sm text-base-content/70">
							{changed.length} transferred, {conflicts.length} conflicts, {problems.length} errors.
						</p>

						{#if pendingDeletes.length}
							<div class="card border border-error/40 bg-base-200 p-3">
								<h3 class="font-semibold">Deletions to confirm</h3>
								<p class="text-xs text-base-content/70">
									Nothing has been deleted yet. Deleting a file removes it from the bucket or from this
									device, and the other devices follow on their next sync.
								</p>
								<ul class="my-2 space-y-1 text-sm">
									{#each pendingDeletes as line (line.path)}
										<li>
											<span class="font-mono text-xs break-all">{line.path}</span>
											<span class="text-xs text-error">
												{line.deletes === 'bucket' ? 'will be deleted from the bucket' : 'will be deleted from this device'}
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
										onclick={() => (lines = lines.map((l) => (l.outcome === 'pending-delete' ? { ...l, outcome: 'skipped' } : l)))}
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
					</section>
				{/if}
			</div>
		</section>
	{/if}
</main>
