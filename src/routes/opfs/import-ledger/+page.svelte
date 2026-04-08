<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { FolderOpenIcon } from '@lucide/svelte';
	import { settings, SettingKeys } from '$lib/settings';

	// ── Glob matching ─────────────────────────────────────────────────────────────
	function globToRegex(pattern: string): RegExp {
		const escaped = pattern
			.trim()
			.replace(/[.+^${}()|[\]\\]/g, '\\$&')
			.replace(/\*/g, '.*')
			.replace(/\?/g, '.');
		return new RegExp(`^${escaped}$`, 'i');
	}

	function parseSpecs(raw: string): RegExp[] {
		return raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.map(globToRegex);
	}

	function matchesAny(name: string, patterns: RegExp[]): boolean {
		return patterns.some((p) => p.test(name));
	}

	// ── OPFS helpers ──────────────────────────────────────────────────────────────
	async function writeOpfsFile(path: string, file: File): Promise<void> {
		const root = await navigator.storage.getDirectory();
		const parts = path.split('/');
		let dir: FileSystemDirectoryHandle = root;
		for (const part of parts.slice(0, -1)) {
			dir = await dir.getDirectoryHandle(part, { create: true });
		}
		const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
		const writable = await fh.createWritable();
		await writable.write(await file.arrayBuffer());
		await writable.close();
	}

	async function opfsFileExists(path: string): Promise<boolean> {
		try {
			const root = await navigator.storage.getDirectory();
			const parts = path.split('/');
			let dir: FileSystemDirectoryHandle = root;
			for (const part of parts.slice(0, -1)) {
				dir = await dir.getDirectoryHandle(part);
			}
			await dir.getFileHandle(parts[parts.length - 1]);
			return true;
		} catch {
			return false;
		}
	}

	// ── Recursive file scanner ────────────────────────────────────────────────────
	async function scanFiles(
		dir: FileSystemDirectoryHandle,
		prefix: string,
		patterns: RegExp[],
		out: Array<{ path: string; handle: FileSystemFileHandle }>
	): Promise<void> {
		// @ts-expect-error entries() is available in modern browsers
		for await (const [name, handle] of dir.entries()) {
			const path = prefix ? `${prefix}/${name}` : name;
			if (handle.kind === 'file' && matchesAny(name, patterns)) {
				out.push({ path, handle: handle as FileSystemFileHandle });
			} else if (handle.kind === 'directory') {
				await scanFiles(handle as FileSystemDirectoryHandle, path, patterns, out);
			}
		}
	}

	// ── State ─────────────────────────────────────────────────────────────────────
	type Phase = 'idle' | 'copying' | 'done' | 'error';

	let dirHandle = $state<FileSystemDirectoryHandle | null>(null);
	let dirName = $state('');
	let fileSpec = $state('*.bean, *.toml');
	let phase = $state<Phase>('idle');
	let progress = $state({ done: 0, total: 0 });
	let statusMsg = $state('');
	let errorMsg = $state('');
	let logLines = $state<string[]>([]);
	let consoleEl = $state<HTMLDivElement | null>(null);

	// Overwrite dialog
	let overwriteDialog = $state<{
		resolve: (choice: 'skip' | 'overwrite' | 'overwriteAll') => void;
		path: string;
	} | null>(null);

	$effect(() => {
		if (logLines.length && consoleEl) {
			consoleEl.scrollTop = consoleEl.scrollHeight;
		}
	});

	onMount(async () => {
		dirName = (await settings.get<string>(SettingKeys.importBookDirectory)) ?? '';
	});

	async function pickDirectory() {
		try {
			const handle = await (window as any).showDirectoryPicker({ mode: 'read' });
			dirHandle = handle;
			dirName = handle.name;
			await settings.set(SettingKeys.importBookDirectory, dirName);
			phase = 'idle';
			statusMsg = '';
			errorMsg = '';
			logLines = [];
		} catch (e: any) {
			if (e?.name !== 'AbortError') {
				errorMsg = e?.message ?? String(e);
			}
		}
	}

	// ── Overwrite dialog helpers ──────────────────────────────────────────────────
	function waitForOverwriteChoice(path: string): Promise<'skip' | 'overwrite' | 'overwriteAll'> {
		return new Promise((resolve) => {
			overwriteDialog = { path, resolve };
		});
	}

	function resolveOverwrite(choice: 'skip' | 'overwrite' | 'overwriteAll') {
		if (overwriteDialog) {
			const { resolve } = overwriteDialog;
			overwriteDialog = null;
			resolve(choice);
		}
	}

	// ── Copy logic ────────────────────────────────────────────────────────────────
	async function copyToOpfs() {
		if (!dirHandle) {
			await pickDirectory();
			if (!dirHandle) return;
		}

		phase = 'copying';
		errorMsg = '';
		progress = { done: 0, total: 0 };
		statusMsg = 'Scanning files…';
		logLines = [];

		try {
			const patterns = parseSpecs(fileSpec);
			if (patterns.length === 0) throw new Error('No valid file specs provided.');

			const files: Array<{ path: string; handle: FileSystemFileHandle }> = [];
			await scanFiles(dirHandle, '', patterns, files);

			progress.total = files.length;
			if (files.length === 0) {
				statusMsg = 'No matching files found.';
				phase = 'done';
				return;
			}

			statusMsg = `Found ${files.length} file(s). Copying…`;
			let overwriteAll = false;

			for (const { path, handle } of files) {
				const exists = await opfsFileExists(path);
				if (exists && !overwriteAll) {
					const choice = await waitForOverwriteChoice(path);
					if (choice === 'skip') {
						logLines = [...logLines, `skipped ${path}`];
						progress.done++;
						continue;
					}
					if (choice === 'overwriteAll') overwriteAll = true;
				}
				logLines = [...logLines, `copying ${path}`];
				const file = await handle.getFile();
				await writeOpfsFile(path, file);
				progress.done++;
				statusMsg = `Copied ${progress.done} / ${progress.total}`;
			}

			phase = 'done';
			statusMsg = `Done — ${progress.done} of ${progress.total} file(s) copied to OPFS.`;
			logLines = [...logLines, statusMsg];
		} catch (e: any) {
			errorMsg = e?.message ?? String(e);
			phase = 'error';
		}
	}
</script>

<div class="h-screen flex flex-col overflow-hidden">
	<Toolbar title="Load Ledger to OPFS" />

	<div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

		<!-- Directory picker -->
		<section class="flex flex-col gap-2">
			<label for="directoryPicker" class="label font-semibold">Source Directory</label>
			<div class="flex items-center gap-2">
				{#if dirName}
					<span class="font-mono text-sm bg-base-200 rounded px-3 py-2 flex-1 truncate">{dirName}/</span>
				{/if}
				<button id="directoryPicker" class="btn btn-primary gap-2" onclick={pickDirectory}>
					<FolderOpenIcon class="w-5 h-5" />
					{dirName ? 'Change' : 'Select Directory'}
				</button>
			</div>
		</section>

		<!-- File spec -->
		<section class="flex flex-col gap-2">
			<label class="label font-semibold" for="filespec">File Spec</label>
			<input
				id="filespec"
				type="text"
				class="input input-bordered font-mono w-full"
				placeholder="*.bean, *.toml"
				bind:value={fileSpec}
			/>
			<p class="text-xs text-base-content/50">
				Comma-separated glob patterns. Matched files are copied recursively, preserving directory
				structure.
			</p>
		</section>

		<!-- Import button -->
		<center class="py-4">
			<button
				class="btn btn-accent"
				disabled={phase === 'copying' || !dirName}
				onclick={copyToOpfs}
			>
				Import
			</button>
		</center>

		<!-- Progress -->
		{#if phase === 'copying' && progress.total > 0}
			<progress class="progress progress-primary w-full" value={progress.done} max={progress.total}
			></progress>
		{/if}

		<!-- Console log -->
		{#if logLines.length > 0}
			<div
				bind:this={consoleEl}
				class="bg-neutral text-neutral-content font-mono text-xs rounded p-2 overflow-y-auto"
				style="height: 7.5rem; min-height: 7.5rem;"
			>
				{#each logLines as line}
					<div>{line}</div>
				{/each}
			</div>
		{/if}

		{#if phase === 'done' && statusMsg}
			<div class="alert alert-success text-sm">
				<span>{statusMsg}</span>
			</div>
		{/if}

		{#if (phase === 'error' || errorMsg) && errorMsg}
			<div class="alert alert-error text-sm">
				<span>{errorMsg}</span>
			</div>
		{/if}

	</div>
</div>

<!-- Overwrite dialog -->
{#if overwriteDialog}
	<div class="modal modal-open">
		<div class="modal-box">
			<h3 class="font-bold text-lg">File already exists</h3>
			<p class="py-3 text-sm font-mono break-all">{overwriteDialog.path}</p>
			<p class="text-sm text-base-content/70">
				This file already exists in OPFS. What would you like to do?
			</p>
			<div class="modal-action flex gap-2">
				<button class="btn btn-sm" onclick={() => resolveOverwrite('skip')}>Skip</button>
				<button class="btn btn-sm btn-warning" onclick={() => resolveOverwrite('overwrite')}
					>Overwrite</button
				>
				<button class="btn btn-sm btn-error" onclick={() => resolveOverwrite('overwriteAll')}
					>Overwrite All</button
				>
			</div>
		</div>
		<div class="modal-backdrop" role="presentation" onclick={() => resolveOverwrite('skip')}></div>
	</div>
{/if}
