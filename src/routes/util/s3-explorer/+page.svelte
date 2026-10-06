<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import Notifier from '$lib/utils/notifier';
	import { isS3Configured, loadS3Config, type S3Config } from '$lib/services/s3Config';
	import {
		deleteObject,
		describeS3Error,
		getObject,
		listDirectory,
		listObjects,
		putObject,
		type S3Directory
	} from '$lib/services/s3Client';
	import { getSyncKey, previewObject } from '$lib/services/s3Sync';
	import {
		EyeIcon,
		SettingsIcon,
		RefreshCwIcon,
		FolderIcon,
		FileIcon,
		DownloadIcon,
		UploadIcon,
		TrashIcon,
		ChevronRightIcon,
		CloudIcon
	} from '@lucide/svelte';

	interface Row {
		name: string;
		isDirectory: boolean;
		size: number | null;
		lastModified: Date | null;
	}

	let cfg = $state<S3Config | null>(null);
	/** Path segments below the configured folder. */
	let segments = $state<string[]>([]);
	let listing = $state<S3Directory>({ folders: [], files: [] });
	let isLoading = $state(false);
	let isBusy = $state(false);
	let toDelete = $state<Row | null>(null);
	let fileInput: HTMLInputElement | undefined = $state();

	const PREVIEW_LIMIT = 200_000;
	let preview = $state<{ name: string; text: string; truncated: boolean } | null>(null);
	let previewing = $state(false);
	let syncKey: CryptoKey | null = null;

	const currentPath = $derived(segments.join('/'));
	// Folders first, then by name.
	const rows = $derived<Row[]>([
		...[...listing.folders]
			.sort((a, b) => a.localeCompare(b))
			.map((name) => ({ name, isDirectory: true, size: null, lastModified: null })),
		...[...listing.files]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((f) => ({ name: f.name, isDirectory: false, size: f.size, lastModified: f.lastModified }))
	]);

	onMount(async () => {
		const saved = await loadS3Config();
		if (isS3Configured(saved)) {
			cfg = saved;
			await refresh();
		}
	});

	const pathOf = (name: string) => (currentPath ? `${currentPath}/${name}` : name);

	async function refresh() {
		if (!cfg) return;
		isLoading = true;
		try {
			listing = await listDirectory(cfg, currentPath);
		} catch (err) {
			listing = { folders: [], files: [] };
			Notifier.error('Listing failed: ' + describeS3Error(err));
		} finally {
			isLoading = false;
		}
	}

	async function goTo(depth: number) {
		segments = segments.slice(0, depth);
		await refresh();
	}

	async function open(row: Row) {
		if (!row.isDirectory) return;
		segments = [...segments, row.name];
		await refresh();
	}

	/** Downloads the object as stored, i.e. still encrypted for the sync data. */
	async function download(row: Row) {
		if (!cfg) return;
		isBusy = true;
		try {
			const bytes = await getObject(cfg, pathOf(row.name));
			if (!bytes) {
				Notifier.error(`${row.name} no longer exists`);
				return;
			}
			const objectUrl = URL.createObjectURL(new Blob([bytes]));
			const a = document.createElement('a');
			a.href = objectUrl;
			a.download = row.name;
			a.click();
			URL.revokeObjectURL(objectUrl);
		} catch (err) {
			Notifier.error('Download error: ' + describeS3Error(err));
		} finally {
			isBusy = false;
		}
	}

	/** Shows the object's content, decrypted on the fly with the configured passphrase. */
	async function showPreview(row: Row) {
		if (!cfg) return;
		previewing = true;
		try {
			syncKey ??= await getSyncKey(cfg);
			const full = await previewObject(cfg, syncKey, pathOf(row.name));
			preview = {
				name: row.name,
				text: full.slice(0, PREVIEW_LIMIT),
				truncated: full.length > PREVIEW_LIMIT
			};
		} catch (err) {
			Notifier.error('Preview failed: ' + describeS3Error(err));
		} finally {
			previewing = false;
		}
	}

	async function copyPreview() {
		if (!preview) return;
		await navigator.clipboard.writeText(preview.text);
		Notifier.success('Copied');
	}

	async function onFilesChosen(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (!cfg || files.length === 0) return;
		isBusy = true;
		try {
			for (const file of files) {
				const bytes = new Uint8Array(await file.arrayBuffer());
				await putObject(cfg, pathOf(file.name), bytes, {
					contentType: file.type || 'application/octet-stream'
				});
				Notifier.success(`Uploaded ${file.name}`);
			}
		} catch (err) {
			Notifier.error('Upload error: ' + describeS3Error(err));
		} finally {
			isBusy = false;
			await refresh();
		}
	}

	async function confirmDelete() {
		const row = toDelete;
		toDelete = null;
		if (!cfg || !row) return;
		isBusy = true;
		try {
			if (row.isDirectory) {
				// A folder is only a key prefix: delete every object under it.
				const keys = await listObjects(cfg, pathOf(row.name) + '/');
				for (const key of keys) await deleteObject(cfg, key);
				Notifier.success(`Deleted ${row.name} (${keys.length} objects)`);
			} else {
				await deleteObject(cfg, pathOf(row.name));
				Notifier.success(`Deleted ${row.name}`);
			}
		} catch (err) {
			Notifier.error('Delete error: ' + describeS3Error(err));
		} finally {
			isBusy = false;
			await refresh();
		}
	}

	function formatFileSize(bytes: number | null): string {
		if (bytes == null) return '--';
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
		return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	function formatDate(d: Date | null): string {
		return d ? d.toLocaleString() : '--';
	}
</script>

<main class="h-screen flex flex-col overflow-hidden">
	<Toolbar title="S3 Explorer">
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
		{#snippet menuItems()}
			<ToolbarMenuItem
				text="Upload File"
				Icon={UploadIcon}
				disabled={!cfg || isBusy}
				onclick={() => fileInput?.click()}
			/>
		{/snippet}
	</Toolbar>

	<input bind:this={fileInput} type="file" multiple class="hidden" onchange={onFilesChosen} />

	<section class="flex-1 overflow-hidden p-4">
		{#if !cfg}
			<p>
				Make sure that you <a href="/settings/s3-cfg" class="link link-primary">configure</a> your S3
				connection first.
			</p>
		{:else}
			<div class="overflow-x-auto overflow-y-auto h-full">
				<div class="flex items-center justify-between pb-1 mb-1">
					<nav class="flex flex-wrap items-center gap-1 text-sm" aria-label="Path">
						<button class="btn btn-ghost btn-xs gap-1" onclick={() => goTo(0)}>
							<CloudIcon size={14} />
							{cfg.bucket}{cfg.prefix ? '/' + cfg.prefix : ''}
						</button>
						{#each segments as seg, i (i)}
							<ChevronRightIcon size={14} class="text-base-content/40" />
							<button class="btn btn-ghost btn-xs" onclick={() => goTo(i + 1)}>{seg}</button>
						{/each}
					</nav>
					<button class="btn btn-ghost btn-xs gap-1" onclick={refresh} title="Refresh">
						<RefreshCwIcon size={14} class={isLoading ? 'animate-spin' : ''} />
						<span class="text-xs opacity-60">Refresh</span>
					</button>
				</div>

				<p class="mb-2 text-xs text-base-content/60">
					Objects are shown as stored. Synced data is encrypted: use Preview to read it, downloads stay
					encrypted.
				</p>

				{#if isLoading && rows.length === 0}
					<div class="flex justify-center items-center p-8">
						<span class="loading loading-spinner loading-lg"></span>
					</div>
				{:else if rows.length === 0}
					<div class="alert alert-info"><span>This folder is empty.</span></div>
				{:else}
					<table class="table table-zebra table-sm">
						<thead>
							<tr>
								<th>Name</th>
								<th>Size</th>
								<th>Last Modified</th>
								<th class="text-center">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each rows as row (row.name)}
								<tr
									class="hover:bg-base-300 has-[.btn-error:hover]:bg-error/20"
									class:cursor-pointer={row.isDirectory}
									onclick={() => open(row)}
								>
									<td class="font-mono text-sm">
										<span class="flex items-center gap-1">
											{#if row.isDirectory}
												<FolderIcon class="w-4 h-4 opacity-60 shrink-0" />
											{:else}
												<FileIcon class="w-4 h-4 opacity-60 shrink-0" />
											{/if}
											{row.name}
										</span>
									</td>
									<td class="text-sm">{formatFileSize(row.size)}</td>
									<td class="text-sm">{formatDate(row.lastModified)}</td>
									<td class="text-right whitespace-nowrap" onclick={(e) => e.stopPropagation()}>
										{#if !row.isDirectory}
											<button
												class="btn btn-sm btn-outline"
												aria-label="Preview {row.name}"
												title="Preview (decrypted)"
												disabled={isBusy || previewing}
												onclick={() => showPreview(row)}
											>
												<EyeIcon class="w-4 h-4" />
											</button>
											<button
												class="btn btn-sm btn-outline"
												aria-label="Download {row.name}"
												title="Download"
												disabled={isBusy}
												onclick={() => download(row)}
											>
												<DownloadIcon class="w-4 h-4" />
											</button>
										{/if}
										<button
											class="btn btn-sm btn-error btn-outline"
											aria-label="Delete {row.name}"
											title="Delete"
											disabled={isBusy}
											onclick={() => (toDelete = row)}
										>
											<TrashIcon class="w-4 h-4" />
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		{/if}
	</section>
</main>

{#if preview}
	<div class="modal modal-open">
		<div class="modal-box flex max-h-[85vh] w-11/12 max-w-3xl flex-col">
			<h3 class="font-mono text-sm font-bold break-all">{preview.name}</h3>
			<pre
				class="my-3 flex-1 overflow-auto rounded bg-base-200 p-2 font-mono text-xs leading-5 whitespace-pre select-text">{preview.text}</pre>
			{#if preview.truncated}
				<p class="text-xs text-warning">Only the first {PREVIEW_LIMIT.toLocaleString()} characters are shown.</p>
			{/if}
			<div class="modal-action mt-2">
				<button class="btn btn-ghost" onclick={copyPreview}>Copy</button>
				<button class="btn" onclick={() => (preview = null)}>Close</button>
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => (preview = null)}></button>
	</div>
{/if}

{#if toDelete}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">Confirm Delete</h3>
			<p class="py-4">
				Delete <strong class="font-mono">{toDelete.name}</strong> from the bucket?
				{#if toDelete.isDirectory}
					<span class="text-error">The folder and everything inside it will be removed.</span>
				{/if}
			</p>
			<div class="modal-action">
				<button class="btn btn-ghost" onclick={() => (toDelete = null)}>Cancel</button>
				<button class="btn btn-error" onclick={confirmDelete}>Delete</button>
			</div>
		</div>
		<button class="modal-backdrop" aria-label="Close" onclick={() => (toDelete = null)}></button>
	</div>
{/if}
