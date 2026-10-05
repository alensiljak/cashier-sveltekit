<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { isS3Configured, loadS3Config, type S3Config } from '$lib/services/s3Config';
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
	<Toolbar title="S3 Sync" />
	{#if ready && cfg}
		<section class="flex-1 space-y-4 overflow-y-auto touch-pan-y p-4">
			<div class="mx-auto max-w-2xl space-y-4">
				<section class="flex items-center justify-between text-sm">
					<span class="font-mono text-xs text-base-content/60">
						{cfg.bucket}{cfg.prefix ? '/' + cfg.prefix : ''}
					</span>
					<a href="/settings/s3-cfg" class="btn btn-ghost btn-sm gap-1">
						<SettingsIcon size={16} />
						Configure
					</a>
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
					<button class="btn btn-primary" disabled={!someSelected}>Upload</button>
					<button class="btn btn-outline btn-error" disabled={!someSelected}>Download</button>
				</section>

				<p class="text-center text-xs text-base-content/50">
					Sync is not implemented yet. This page is a skeleton.
				</p>
			</div>
		</section>
	{/if}
</main>
