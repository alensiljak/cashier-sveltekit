<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import {
		clearSharedFiles,
		isPdf,
		readSharedFiles,
		storeSharedFiles,
		type SharedFile
	} from '#lib/services/sharedFiles';

	let files = $state<SharedFile[]>([]);
	let loading = $state(true);
	let readFailed = $state(false);
	let failed = $derived(readFailed || page.url.searchParams.has('error'));

	onMount(async () => {
		try {
			files = await readSharedFiles();
		} catch (err) {
			console.error('Failed to read shared files:', err);
			readFailed = true;
		} finally {
			loading = false;
		}
	});

	async function discard() {
		await clearSharedFiles();
		files = [];
	}

	// Files from drag & drop or the picker go through the same store as shared ones.
	let dragging = $state(false);

	async function addFiles(list: FileList | null | undefined) {
		const picked = Array.from(list ?? []);
		if (picked.length === 0) return;
		try {
			await storeSharedFiles(picked);
			files = await readSharedFiles();
			readFailed = false;
		} catch (err) {
			console.error('Failed to store files:', err);
			readFailed = true;
		}
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		void addFiles(event.dataTransfer?.files);
	}

	function formatSize(bytes: number): string {
		return bytes < 1024 * 1024
			? `${(bytes / 1024).toFixed(1)} KB`
			: `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="Shared Files"></Toolbar>

	<section class="space-y-4 p-2 mx-auto max-w-2xl w-full">
		<label
			class="flex cursor-pointer flex-col items-center gap-1 rounded-box border-2 border-dashed p-6 text-center {dragging
				? 'border-primary bg-base-200'
				: 'border-base-content/30'}"
			ondragover={(e) => {
				e.preventDefault();
				dragging = true;
			}}
			ondragleave={() => (dragging = false)}
			ondrop={onDrop}
		>
			<span class="font-medium">Drop distribution statements here</span>
			<span class="text-sm opacity-60">or tap to choose files (PDF)</span>
			<input
				type="file"
				class="hidden"
				accept="application/pdf,.pdf"
				multiple
				onchange={(e) => {
					void addFiles(e.currentTarget.files);
					e.currentTarget.value = '';
				}}
			/>
		</label>

		{#if loading}
			<span class="loading loading-spinner"></span>
		{:else if failed}
			<div class="alert alert-error">The file could not be received.</div>
		{:else if files.length === 0}
			<div class="alert alert-info">
				No files yet. You can also share a PDF to Cashier from another app.
			</div>
		{:else}
			<ul class="list bg-base-100 rounded-box shadow-md">
				{#each files as file}
					<li class="list-row">
						<div class="list-col-grow">
							<div class="break-all">{file.name}</div>
							<div class="text-xs opacity-60">
								{formatSize(file.size)}{isPdf(file) ? '' : ' · not a PDF'}
							</div>
						</div>
					</li>
				{/each}
			</ul>
			<button class="btn btn-outline" onclick={discard}>Discard</button>
		{/if}
	</section>
</main>
