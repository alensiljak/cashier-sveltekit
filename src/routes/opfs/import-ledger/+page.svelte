<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { FolderOpenIcon } from '@lucide/svelte';
	import { settings, SettingKeys } from '$lib/settings';

	// ── IndexedDB handle persistence ──────────────────────────────────────────────
	const IDB_NAME = 'cashier-fs-handles';
	const IDB_STORE = 'handles';
	const HANDLE_KEY = 'importLedgerDirectoryHandle';

	function openIdb(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const req = indexedDB.open(IDB_NAME, 1);
			req.onupgradeneeded = () => {
				req.result.createObjectStore(IDB_STORE);
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	async function persistHandle(handle: FileSystemDirectoryHandle): Promise<void> {
		const db = await openIdb();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(IDB_STORE, 'readwrite');
			tx.objectStore(IDB_STORE).put(handle, HANDLE_KEY);
			tx.oncomplete = () => { db.close(); resolve(); };
			tx.onerror = () => { db.close(); reject(tx.error); };
		});
	}

	async function loadPersistedHandle(): Promise<FileSystemDirectoryHandle | null> {
		try {
			const db = await openIdb();
			return new Promise((resolve, reject) => {
				const tx = db.transaction(IDB_STORE, 'readonly');
				const req = tx.objectStore(IDB_STORE).get(HANDLE_KEY);
				req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
				req.onerror = () => { db.close(); reject(req.error); };
			});
		} catch {
			return null;
		}
	}

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

	// ── Hashing ───────────────────────────────────────────────────────────────────
	async function hashBuffer(buf: ArrayBuffer): Promise<string> {
		const digest = await crypto.subtle.digest('SHA-256', buf);
		return Array.from(new Uint8Array(digest))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}

	async function hashOpfsFile(path: string): Promise<string | null> {
		try {
			const root = await navigator.storage.getDirectory();
			const parts = path.split('/');
			let dir: FileSystemDirectoryHandle = root;
			for (const part of parts.slice(0, -1)) {
				dir = await dir.getDirectoryHandle(part);
			}
			const fh = await dir.getFileHandle(parts[parts.length - 1]);
			const file = await fh.getFile();
			return hashBuffer(await file.arrayBuffer());
		} catch {
			return null;
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
	type Phase = 'idle' | 'scanning' | 'copying' | 'done' | 'error';
	type FileStatus = 'new' | 'modified' | 'identical';
	type ScannedFile = { path: string; getFile: () => Promise<File>; status: FileStatus };

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
	let scanStats = $state<{ new: number; modified: number; identical: number } | null>(null);
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
		return () => { if (timer) clearInterval(timer); };
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
			const stored = await loadPersistedHandle();
			if (stored) {
				try {
					const permission = await (stored as any).requestPermission({ mode: 'read' });
					if (permission === 'granted') {
						dirHandle = stored;
						await scanAndCompare();
					}
				} catch {
					// Permission denied or unavailable
				}
			}
		}
	});

	function invalidateScan() {
		scanStats = null;
		scannedFiles = [];
	}

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
		scanAndCompare();
	}

	async function pickDirectory() {
		try {
			const handle = await (window as any).showDirectoryPicker({ mode: 'read' });
			dirHandle = handle;
			dirName = handle.name;
			await settings.set(SettingKeys.importBookDirectory, dirName);
			await persistHandle(handle);
			phase = 'idle';
			statusMsg = '';
			errorMsg = '';
			logLines = [];
			await scanAndCompare();
		} catch (e: any) {
			if (e?.name !== 'AbortError') {
				errorMsg = e?.message ?? String(e);
			}
		}
	}

	// ── Scan & compare ────────────────────────────────────────────────────────────
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

			const rawFiles: Array<{ path: string; getFile: () => Promise<File> }> = [];

			if (dirHandle) {
				const handles: Array<{ path: string; handle: FileSystemFileHandle }> = [];
				await scanFiles(dirHandle, '', patterns, handles);
				for (const { path, handle } of handles) {
					rawFiles.push({ path, getFile: () => handle.getFile() });
				}
			} else if (fallbackFiles) {
				for (const f of fallbackFiles) {
					const parts = f.webkitRelativePath.split('/');
					const path = parts.slice(1).join('/');
					if (path && matchesAny(parts[parts.length - 1], patterns)) {
						const captured = f;
						rawFiles.push({ path, getFile: async () => captured });
					}
				}
			}

			scanProgress.total = rawFiles.length;
			const result: ScannedFile[] = [];
			const stats = { new: 0, modified: 0, identical: 0 };

			for (const { path, getFile } of rawFiles) {
				const opfsHash = await hashOpfsFile(path);
				let status: FileStatus;
				if (opfsHash === null) {
					status = 'new';
					stats.new++;
				} else {
					const file = await getFile();
					const srcHash = await hashBuffer(await file.arrayBuffer());
					status = srcHash === opfsHash ? 'identical' : 'modified';
					stats[status]++;
				}
				result.push({ path, getFile, status });
				scanProgress.done++;
			}

			scannedFiles = result;
			scanStats = stats;
			phase = 'idle';
		} catch (e: any) {
			errorMsg = e?.message ?? String(e);
			phase = 'error';
		}
	}

	// ── Copy logic ────────────────────────────────────────────────────────────────
	async function copyToOpfs() {
		if (scannedFiles.length === 0) return;

		phase = 'copying';
		errorMsg = '';
		progress = { done: 0, total: 0 };
		statusMsg = '';
		logLines = [];

		try {
			await settings.set(SettingKeys.importBookFileSpec, fileSpec);

			const filesToCopy =
				importMode === 'modified'
					? scannedFiles.filter((f) => f.status !== 'identical')
					: scannedFiles;

			progress.total = filesToCopy.length;

			if (filesToCopy.length === 0) {
				statusMsg = 'Nothing to import — all files are identical.';
				phase = 'done';
				return;
			}

			statusMsg = `Copying ${filesToCopy.length} file(s)…`;

			for (const { path, getFile, status } of filesToCopy) {
				logLines = [...logLines, `${status}: ${path}`];
				const file = await getFile();
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
				oninput={invalidateScan}
			/>
			<p class="text-xs text-base-content/50">
				Comma-separated glob patterns. Matched files are copied recursively, preserving directory
				structure.
			</p>
		</section>

		<!-- Scan results -->
		{#if phase === 'scanning'}
			<section class="flex items-center gap-3 text-sm text-base-content/70">
				<span class="loading loading-spinner loading-sm"></span>
				<span>
					Scanning…
					{#if scanProgress.total > 0}
						({scanProgress.done} / {scanProgress.total})
					{/if}
				</span>
			</section>
		{:else if scanStats !== null}
			<section class="flex flex-col gap-3">
				<div class="flex items-center gap-2 flex-wrap">
					<span class="text-sm font-semibold text-base-content/70">Scan results:</span>
					<span class="badge badge-success gap-1">
						{scanStats.new} new
					</span>
					<span class="badge badge-warning gap-1">
						{scanStats.modified} modified
					</span>
					<span class="badge badge-ghost gap-1">
						{scanStats.identical} identical
					</span>
					<button
						class="btn btn-sm btn-ghost ml-auto"
						disabled={phase === 'copying'}
						onclick={scanAndCompare}
					>
						Rescan
					</button>
				</div>

				<!-- Import mode -->
				<div class="flex gap-6">
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="radio"
							class="radio radio-sm"
							name="importMode"
							value="modified"
							bind:group={importMode}
						/>
						<span class="text-sm">Import new &amp; modified only</span>
						<span class="badge badge-sm badge-outline">
							{scannedFiles.filter((f) => f.status !== 'identical').length} files
						</span>
					</label>
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="radio"
							class="radio radio-sm"
							name="importMode"
							value="all"
							bind:group={importMode}
						/>
						<span class="text-sm">Import all</span>
						<span class="badge badge-sm badge-outline">{scannedFiles.length} files</span>
					</label>
				</div>
			</section>
		{:else if dirName && phase === 'idle'}
			<section class="text-sm text-base-content/50 italic">
				Scan pending — change the file spec or
				<button class="link" onclick={scanAndCompare}>scan now</button>.
			</section>
		{/if}

		<!-- Import button -->
		<center class="py-4">
			<button
				class="btn btn-accent text-secondary"
				disabled={phase === 'copying' || phase === 'scanning' || filesToImportCount === 0}
				onclick={copyToOpfs}
			>
				Import
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

		{#if (phase === 'error' || errorMsg) && errorMsg}
			<div class="alert alert-error text-sm">
				<span>{errorMsg}</span>
			</div>
		{/if}

	</div>
</div>
