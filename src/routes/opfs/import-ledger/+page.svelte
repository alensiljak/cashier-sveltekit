<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { FolderOpenIcon, RefreshCcwIcon } from '@lucide/svelte';
	import { settings, SettingKeys } from '$lib/settings';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import {
		loadPersistedHandle,
		persistHandle,
		requestReadPermission
	} from '$lib/utils/fsHandleStore';
	import {
		deleteManifestEntry,
		getManifest,
		putManifestEntry,
		type ImportedFileMeta
	} from '$lib/utils/importManifest';
	import { processWithConcurrencyLimit } from '$lib/utils/concurrency';

	const HANDLE_KEY = 'importLedgerDirectoryHandle';
	const CONCURRENCY = 4;

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
		await writable.write(file);
		await writable.close();
	}

	async function deleteOpfsFile(path: string): Promise<void> {
		const root = await navigator.storage.getDirectory();
		const parts = path.split('/');
		let dir: FileSystemDirectoryHandle = root;
		for (const part of parts.slice(0, -1)) {
			try {
				dir = await dir.getDirectoryHandle(part);
			} catch {
				return;
			}
		}
		try {
			await dir.removeEntry(parts[parts.length - 1]);
		} catch {
			// already gone
		}
	}

	// ── Recursive file handle collector ───────────────────────────────────────────
	async function collectFileHandles(
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
				await collectFileHandles(handle as FileSystemDirectoryHandle, path, patterns, out);
			}
		}
	}

	// ── State ─────────────────────────────────────────────────────────────────────
	type Phase = 'idle' | 'scanning' | 'copying' | 'done' | 'error';
	type FileStatus = 'new' | 'modified' | 'identical' | 'deleted';
	type ScannedFile = {
		path: string;
		size: number;
		lastModified: number;
		getFile?: () => Promise<File>;
		status: FileStatus;
	};

	let dirHandle = $state<FileSystemDirectoryHandle | null>(null);
	let fallbackFiles = $state<File[] | null>(null);
	let hasDirectoryPicker = $state(false);
	let dirName = $state('');
	let fileSpec = $state('*.bean, *.toml');
	let phase = $state<Phase>('idle');
	let progress = $state({ done: 0, total: 0 });
	let scanProgress = $state({ done: 0, total: 0 });
	let statusMsg = $state('');
	let errorMsg = $state('');
	let logLines = $state<string[]>([]);
	let consoleEl = $state<HTMLDivElement | null>(null);
	let hourglassTick = $state(0);
	let scannedFiles = $state<ScannedFile[]>([]);
	let reloadPhase = $state<'idle' | 'reloading' | 'done' | 'error'>('idle');
	let reloadError = $state('');
	let scanStats = $state<{
		new: number;
		modified: number;
		identical: number;
		deleted: number;
	} | null>(null);
	let importMode = $state<'all' | 'modified'>('modified');

	let filesToImportCount = $derived(
		importMode === 'modified'
			? scannedFiles.filter((f) => f.status !== 'identical').length
			: scannedFiles.length
	);

	$effect(() => {
		let timer: ReturnType<typeof setInterval> | null = null;
		if (phase === 'copying') {
			timer = setInterval(() => hourglassTick++, 600);
		} else {
			hourglassTick = 0;
		}
		return () => {
			if (timer) clearInterval(timer);
		};
	});

	$effect(() => {
		if (logLines.length && consoleEl) {
			consoleEl.scrollTop = consoleEl.scrollHeight;
		}
	});

	onMount(async () => {
		hasDirectoryPicker = 'showDirectoryPicker' in window;
		dirName = (await settings.get<string>(SettingKeys.importBookDirectory)) ?? '';
		fileSpec = (await settings.get<string>(SettingKeys.importBookFileSpec)) ?? fileSpec;
		if (hasDirectoryPicker) {
			const stored = await loadPersistedHandle(HANDLE_KEY);
			if (stored && (await requestReadPermission(stored))) {
				dirHandle = stored;
			}
		}
	});

	function handleFallbackInput(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = input.files;
		if (!files || files.length === 0) return;
		const rootName = files[0].webkitRelativePath.split('/')[0];
		fallbackFiles = Array.from(files);
		dirHandle = null;
		dirName = rootName;
		settings.set(SettingKeys.importBookDirectory, dirName);
		phase = 'idle';
		statusMsg = '';
		errorMsg = '';
		logLines = [];
	}

	async function pickDirectory() {
		try {
			const handle = await (
				window as unknown as {
					showDirectoryPicker: (opts: { mode: 'read' }) => Promise<FileSystemDirectoryHandle>;
				}
			).showDirectoryPicker({ mode: 'read' });
			dirHandle = handle;
			dirName = handle.name;
			await settings.set(SettingKeys.importBookDirectory, dirName);
			await persistHandle(HANDLE_KEY, handle);
			phase = 'idle';
			statusMsg = '';
			errorMsg = '';
			logLines = [];
		} catch (e) {
			const err = e as { name?: string; message?: string };
			if (err?.name !== 'AbortError') {
				errorMsg = err?.message ?? String(e);
			}
		}
	}

	// ── Scan & compare (metadata-based) ───────────────────────────────────────────
	async function scanAndCompare() {
		if (!dirHandle && !fallbackFiles) return;

		phase = 'scanning';
		errorMsg = '';
		scanStats = null;
		scannedFiles = [];
		scanProgress = { done: 0, total: 0 };

		try {
			const patterns = parseSpecs(fileSpec);
			if (patterns.length === 0) throw new Error('No valid file specs provided.');

			type RawFile = {
				path: string;
				getFile: () => Promise<File>;
				sizeHint?: number;
				mtimeHint?: number;
			};
			const rawFiles: RawFile[] = [];

			if (dirHandle) {
				const handles: Array<{ path: string; handle: FileSystemFileHandle }> = [];
				await collectFileHandles(dirHandle, '', patterns, handles);
				for (const { path, handle } of handles) {
					rawFiles.push({ path, getFile: () => handle.getFile() });
				}
			} else if (fallbackFiles) {
				for (const f of fallbackFiles) {
					const parts = f.webkitRelativePath.split('/');
					const path = parts.slice(1).join('/');
					if (path && matchesAny(parts[parts.length - 1], patterns)) {
						const captured = f;
						rawFiles.push({
							path,
							getFile: async () => captured,
							sizeHint: f.size,
							mtimeHint: f.lastModified
						});
					}
				}
			}

			scanProgress.total = rawFiles.length;

			const manifest = await getManifest();
			const seen = new Set<string>();
			const result: ScannedFile[] = new Array(rawFiles.length);
			const stats = { new: 0, modified: 0, identical: 0, deleted: 0 };

			await processWithConcurrencyLimit(
				rawFiles.map((rf, idx) => ({ rf, idx })),
				CONCURRENCY,
				async ({ rf, idx }) => {
					let size: number;
					let lastModified: number;
					if (rf.sizeHint !== undefined && rf.mtimeHint !== undefined) {
						size = rf.sizeHint;
						lastModified = rf.mtimeHint;
					} else {
						const file = await rf.getFile();
						size = file.size;
						lastModified = file.lastModified;
					}

					const prev = manifest.get(rf.path);
					let status: FileStatus;
					if (!prev) {
						status = 'new';
					} else if (prev.size === size && prev.lastModified === lastModified) {
						status = 'identical';
					} else {
						status = 'modified';
					}

					result[idx] = {
						path: rf.path,
						size,
						lastModified,
						getFile: rf.getFile,
						status
					};
					seen.add(rf.path);
					stats[status]++;
					scanProgress.done++;
				}
			);

			// Detect deletions: manifest entries that no longer exist in source
			for (const [path, meta] of manifest) {
				if (!seen.has(path)) {
					result.push({
						path,
						size: meta.size,
						lastModified: meta.lastModified,
						status: 'deleted'
					});
					stats.deleted++;
				}
			}

			scannedFiles = result;
			scanStats = stats;
			phase = 'idle';
		} catch (e) {
			const err = e as { message?: string };
			errorMsg = err?.message ?? String(e);
			phase = 'error';
		}
	}

	// ── Reload ledger ─────────────────────────────────────────────────────────────
	async function reloadLedger() {
		reloadPhase = 'reloading';
		reloadError = '';
		try {
			await fullLedgerService.invalidate();
			reloadPhase = 'done';
		} catch (e) {
			const err = e as { message?: string };
			reloadError = err?.message ?? String(e);
			reloadPhase = 'error';
		}
	}

	// ── Sync (copy new/modified, remove deleted) ──────────────────────────────────
	async function syncToOpfs() {
		if (scannedFiles.length === 0) return;

		phase = 'copying';
		errorMsg = '';
		progress = { done: 0, total: 0 };
		statusMsg = '';
		logLines = [];

		try {
			const toCopy =
				importMode === 'modified'
					? scannedFiles.filter((f) => f.status === 'new' || f.status === 'modified')
					: scannedFiles.filter((f) => f.status !== 'deleted');
			const toDelete = scannedFiles.filter((f) => f.status === 'deleted');

			progress.total = toCopy.length + toDelete.length;

			if (progress.total === 0) {
				statusMsg = 'Nothing to sync — everything is up to date.';
				phase = 'done';
				return;
			}

			statusMsg = `Syncing ${progress.total} file(s)…`;

			await processWithConcurrencyLimit(toCopy, CONCURRENCY, async (entry) => {
				if (!entry.getFile) return;
				const file = await entry.getFile();
				await writeOpfsFile(entry.path, file);
				await putManifestEntry({
					path: entry.path,
					size: file.size,
					lastModified: file.lastModified,
					importedAt: Date.now()
				} satisfies ImportedFileMeta);
				logLines = [...logLines, `${entry.status}: ${entry.path}`];
				progress.done++;
				statusMsg = `Synced ${progress.done} / ${progress.total}`;
			});

			await processWithConcurrencyLimit(toDelete, CONCURRENCY, async (entry) => {
				await deleteOpfsFile(entry.path);
				await deleteManifestEntry(entry.path);
				logLines = [...logLines, `deleted: ${entry.path}`];
				progress.done++;
				statusMsg = `Synced ${progress.done} / ${progress.total}`;
			});

			phase = 'done';
			statusMsg = `Done — ${progress.done} of ${progress.total} file(s) synced.`;
			logLines = [...logLines, statusMsg];

			await scanAndCompare();
		} catch (e) {
			const err = e as { message?: string };
			errorMsg = err?.message ?? String(e);
			phase = 'error';
		}
	}
</script>

<div class="h-screen flex flex-col overflow-hidden">
	<Toolbar title="Import Ledger to OPFS" />

	<div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

		<!-- Directory picker -->
		<section class="flex flex-col gap-2">
			<label for="directoryPicker" class="label font-semibold">Source Directory</label>
			<div class="flex items-center gap-2">
				{#if dirName}
					<span class="font-mono text-sm bg-base-200 rounded px-3 py-2 flex-1 truncate">{dirName}/</span>
				{/if}
				{#if hasDirectoryPicker}
					<button id="directoryPicker" class="btn btn-primary gap-2" onclick={pickDirectory}>
						<FolderOpenIcon class="w-5 h-5" />
						{dirName ? 'Change' : 'Select Directory'}
					</button>
				{:else}
					<label id="directoryPicker" class="btn btn-primary gap-2 cursor-pointer">
						<FolderOpenIcon class="w-5 h-5" />
						{dirName ? 'Change' : 'Select Directory'}
						<input
							type="file"
							class="hidden"
							{...{ webkitdirectory: true }}
							onchange={handleFallbackInput}
						/>
					</label>
				{/if}
				{#if dirHandle || fallbackFiles}
					<button
						class="btn btn-secondary gap-2"
						disabled={phase === 'scanning' || phase === 'copying'}
						onclick={scanAndCompare}
					>
						<RefreshCcwIcon class="w-4 h-4 {phase === 'scanning' ? 'animate-spin' : ''}" />
						Scan
					</button>
				{/if}
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
				onblur={async () => {
					await settings.set(SettingKeys.importBookFileSpec, fileSpec);
				}}
			/>
			<p class="text-xs text-base-content/50">
				Comma-separated glob patterns. Matched files are copied recursively, preserving directory
				structure.
			</p>
		</section>

		<!-- Scan progress -->
		{#if phase === 'scanning'}
			<div class="flex items-center gap-2 text-sm text-base-content/70">
				<span class="loading loading-spinner loading-sm"></span>
				Scanning
				{#if scanProgress.total > 0}
					({scanProgress.done} / {scanProgress.total})
				{/if}
			</div>
		{/if}

		<!-- Scan results -->
		{#if scanStats !== null}
			<section class="flex flex-col gap-3">
				<div class="flex items-center gap-2 flex-wrap">
					<span class="text-sm font-semibold text-base-content/70">Scan results:</span>
					<span class="badge badge-success">{scanStats.new} new</span>
					<span class="badge badge-warning">{scanStats.modified} modified</span>
					<span class="badge badge-ghost">{scanStats.identical} identical</span>
					{#if scanStats.deleted > 0}
						<span class="badge badge-error">{scanStats.deleted} deleted</span>
					{/if}
				</div>

				<!-- Import mode -->
				<div class="flex flex-wrap gap-6">
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="radio"
							class="radio radio-sm"
							name="importMode"
							value="modified"
							bind:group={importMode}
						/>
						<span class="text-sm">Sync new, modified &amp; deleted</span>
					</label>
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="radio"
							class="radio radio-sm"
							name="importMode"
							value="all"
							bind:group={importMode}
						/>
						<span class="text-sm">Re-copy all</span>
					</label>
				</div>

				<!-- File preview list -->
				{#if scannedFiles.length > 0}
					{@const preview =
						importMode === 'modified'
							? scannedFiles.filter((f) => f.status !== 'identical')
							: scannedFiles}
					{#if preview.length > 0}
						<div
							class="overflow-y-auto border border-base-300 rounded font-mono text-xs"
							style="max-height: 5.5rem;"
						>
							{#each preview as file}
								<div class="flex items-center gap-2 px-2 py-0.5 hover:bg-base-200">
									<span
										class="badge badge-xs shrink-0 {file.status === 'new'
											? 'badge-success'
											: file.status === 'modified'
												? 'badge-warning'
												: file.status === 'deleted'
													? 'badge-error'
													: 'badge-ghost'}">{file.status}</span>
									<span class="truncate">{file.path}</span>
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			</section>
		{/if}

		<hr class="my-6 mx-4" />

		<!-- Sync button -->
		<center class="py-4">
			<button
				class="btn btn-accent text-secondary"
				disabled={phase === 'copying' || phase === 'scanning' || filesToImportCount === 0}
				onclick={syncToOpfs}
			>
				Sync
				{#if scanStats !== null && filesToImportCount > 0}
					<span class="badge badge-sm">{filesToImportCount}</span>
				{/if}
			</button>
			{#if phase === 'copying'}
				<div class="mt-3 text-2xl" aria-label="Working…">
					{hourglassTick % 2 === 0 ? '⏳' : '⌛'}
				</div>
			{/if}
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

		{#if phase === 'done'}
			<center class="py-4">
				<button
					class="btn btn-outline"
					disabled={reloadPhase === 'reloading'}
					onclick={reloadLedger}
				>
					{#if reloadPhase === 'reloading'}
						<span class="loading loading-spinner loading-sm"></span>
						Reloading…
					{:else}
						<RefreshCcwIcon class="w-4 h-4" />
						Reload Ledger
					{/if}
				</button>
				{#if reloadPhase === 'done'}
					<p class="text-xs text-success mt-2">Ledger reloaded.</p>
				{/if}
				{#if reloadError}
					<p class="text-xs text-error mt-2">{reloadError}</p>
				{/if}
			</center>
		{/if}

		{#if (phase === 'error' || errorMsg) && errorMsg}
			<div class="alert alert-error text-sm">
				<span>{errorMsg}</span>
			</div>
		{/if}

	</div>
</div>
