<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { RefreshCwIcon } from '@lucide/svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import DiffViewer from '#lib/components/DiffViewer.svelte';
	import Notifier from '#lib/utils/notifier';
	import { isS3Configured, loadS3Config, type S3Config } from '#lib/services/s3Config';
	import { describeS3Error } from '#lib/services/s3Client';
	import {
		compareSettings,
		openSession,
		resolveConflict,
		type FileComparison,
		type S3Session
	} from '#lib/services/s3Sync';

	let cfg = $state<S3Config | null>(null);
	// Raw: the session is mutated by the sync service, which must not go through a proxy.
	let session = $state.raw<S3Session | null>(null);
	let comparison = $state<FileComparison | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let working = $state(false);

	async function load() {
		if (!cfg) return;
		loading = true;
		error = null;
		try {
			session = await openSession(cfg);
			comparison = await compareSettings(session);
		} catch (e) {
			error = e instanceof Error ? e.message : describeS3Error(e);
		} finally {
			loading = false;
		}
	}

	async function resolve(keep: 'local' | 'remote') {
		if (!session) return;
		working = true;
		try {
			const result = await resolveConflict(
				session,
				{ item: 'settings', path: 'settings.json', outcome: 'conflict' },
				keep
			);
			if (result.outcome === 'error') {
				Notifier.error(`settings.json: ${result.message}`);
				return;
			}
			Notifier.success(`settings.json: ${result.outcome}.`);
			await load();
		} finally {
			working = false;
		}
	}

	onMount(async () => {
		const saved = await loadS3Config();
		if (!isS3Configured(saved)) {
			await goto('/settings/s3-cfg', { replace: true });
			return;
		}
		cfg = saved;
		if (!saved.passphrase) {
			error = 'Set an encryption passphrase in the S3 configuration first.';
			return;
		}
		await load();
	});
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="S3 Settings Diff">
		{#snippet actions()}
			<button
				class="btn btn-ghost btn-sm btn-square"
				aria-label="Refresh"
				title="Refresh"
				disabled={loading || !cfg?.passphrase}
				onclick={load}
			>
				<RefreshCwIcon size={20} class={loading ? 'animate-spin' : ''} />
			</button>
		{/snippet}
	</Toolbar>

	<section class="flex-1 space-y-3 overflow-y-auto touch-pan-y p-4">
		<div class="mx-auto max-w-2xl space-y-3">
			{#if error}
				<div class="alert alert-warning text-sm"><span>{error}</span></div>
			{/if}

			{#if loading && !comparison}
				<div class="flex justify-center p-8"><span class="loading loading-spinner"></span></div>
			{:else if comparison}
				{#if comparison.localText === null}
					<div class="alert alert-info text-sm">
						<span>No settings on this device. The bucket's version is shown below.</span>
					</div>
				{:else if comparison.remoteText === null}
					<div class="alert alert-info text-sm">
						<span>Not in the bucket (or deleted there). This device's version is shown below.</span>
					</div>
				{:else if comparison.sameText}
					<div class="alert alert-success text-sm">
						<span>
							{comparison.identical
								? 'The two versions are identical.'
								: 'The text is the same: only line endings or the final newline differ.'}
						</span>
					</div>
				{/if}

				{#if comparison.localText !== null && comparison.remoteText !== null && !comparison.sameText}
					<DiffViewer
						oldText={comparison.localText}
						newText={comparison.remoteText}
						banner={{
							text: 'Red lines (-) are only on this device. Green lines (+) are only in the bucket.',
							alertClass: 'alert-info'
						}}
					/>
				{:else if comparison.localText !== null && comparison.remoteText === null}
					<pre class="bg-base-200 overflow-x-auto rounded p-2 text-xs">{comparison.localText}</pre>
				{:else if comparison.localText === null && comparison.remoteText !== null}
					<pre class="bg-base-200 overflow-x-auto rounded p-2 text-xs">{comparison.remoteText}</pre>
				{/if}

				{#if !comparison.sameText}
					<div class="flex flex-wrap items-center justify-end gap-2">
						<span class="text-base-content/60 mr-auto text-xs">Resolve by keeping one side:</span>
						<button class="btn btn-sm btn-outline" disabled={working} onclick={() => resolve('local')}>
							Keep this device
						</button>
						<button class="btn btn-sm btn-outline" disabled={working} onclick={() => resolve('remote')}>
							Keep bucket
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</section>
</main>
