<script lang="ts">
	/*
Here we test copying all Beancount files into OPFS and then reading them into the Full Ledger.
The performance should be significantly better than reading from the File System API.
*/

	import { settings, SettingKeys } from '$lib/settings';
	import { ensureInitialized, createLedger } from '$lib/services/rustledger';
	import type { Ledger, QueryResult } from '@rustledger/wasm';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import { BoxIcon } from '@lucide/svelte';
	import { goto } from '$app/navigation';

	// ── IDB ──────────────────────────────────────────────────────────────────────
	const IDB_NAME = 'cashier-fs-handles';
	const IDB_STORE = 'handles';
	const HANDLE_KEY = 'fsSyncDirectoryHandle';

	function openIdb(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const req = indexedDB.open(IDB_NAME, 1);
			req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	async function loadFsHandle(): Promise<FileSystemDirectoryHandle | null> {
		try {
			const db = await openIdb();
			return new Promise((resolve, reject) => {
				const tx = db.transaction(IDB_STORE, 'readonly');
				const req = tx.objectStore(IDB_STORE).get(HANDLE_KEY);
				req.onsuccess = () => {
					db.close();
					resolve(req.result ?? null);
				};
				req.onerror = () => {
					db.close();
					reject(req.error);
				};
			});
		} catch {
			return null;
		}
	}

	// ── OPFS helpers (supports subdirectory paths like "2024/expenses.bean") ─────
	async function writeOpfsFile(path: string, content: string): Promise<void> {
		const root = await navigator.storage.getDirectory();
		const parts = path.split('/');
		let dir: FileSystemDirectoryHandle = root;
		for (const part of parts.slice(0, -1)) {
			dir = await dir.getDirectoryHandle(part, { create: true });
		}
		const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
		const writable = await fh.createWritable();
		await writable.write(new TextEncoder().encode(content));
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

	async function readOpfsFile(path: string): Promise<string | null> {
		try {
			const root = await navigator.storage.getDirectory();
			const parts = path.split('/');
			let dir: FileSystemDirectoryHandle = root;
			for (const part of parts.slice(0, -1)) {
				dir = await dir.getDirectoryHandle(part);
			}
			const fh = await dir.getFileHandle(parts[parts.length - 1]);
			const file = await fh.getFile();
			return file.text();
		} catch {
			return null;
		}
	}

	/** Recursively collect all .bean file paths in an OPFS directory. */
	async function collectOpfsBeanFiles(
		dir: FileSystemDirectoryHandle,
		prefix: string,
		out: Map<string, string>
	): Promise<void> {
		// @ts-expect-error entries() is available
		for await (const [name, handle] of dir.entries()) {
			const path = prefix ? `${prefix}/${name}` : name;
			if (handle.kind === 'file' && name.endsWith('.bean')) {
				const file = await (handle as FileSystemFileHandle).getFile();
				out.set(path, await file.text());
			} else if (handle.kind === 'directory') {
				await collectOpfsBeanFiles(handle as FileSystemDirectoryHandle, path, out);
			}
		}
	}

	/** Recursively list all .bean files from an FS API directory handle. */
	async function scanFsBeanFiles(
		dir: FileSystemDirectoryHandle,
		prefix: string,
		out: Array<{ path: string; handle: FileSystemFileHandle }>
	): Promise<void> {
		// @ts-expect-error entries() is available
		for await (const [name, handle] of dir.entries()) {
			const path = prefix ? `${prefix}/${name}` : name;
			if (handle.kind === 'file' && name.endsWith('.bean')) {
				out.push({ path, handle: handle as FileSystemFileHandle });
			} else if (handle.kind === 'directory') {
				await scanFsBeanFiles(handle as FileSystemDirectoryHandle, path, out);
			}
		}
	}

	// ── State ─────────────────────────────────────────────────────────────────────
	type Phase = 'idle' | 'copying' | 'copied' | 'loading' | 'loaded' | 'error';

	let phase = $state<Phase>('idle');
	let statusMsg = $state('');
	let copyProgress = $state({ done: 0, total: 0 });
	let timings = $state<{ copy?: number; load?: number }>({});
	let directiveCount = $state(0);
	let errorMsg = $state('');

	// Overwrite dialog
	let overwriteDialog = $state<{
		resolve: (choice: 'skip' | 'overwrite' | 'overwriteAll') => void;
		path: string;
	} | null>(null);

	// Ledger
	let ledger = $state<Ledger | null>(null);

	// Query panel
	let bql = $state('SELECT account, sum(position) AS balance GROUP BY account ORDER BY account');
	let queryRunning = $state(false);
	let queryResult = $state<{ columns: string[]; rows: any[]; errors: any[] } | null>(null);

	// ── Copy logic ────────────────────────────────────────────────────────────────
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

	async function copyFilesToOpfs() {
		phase = 'copying';
		statusMsg = 'Loading filesystem handle…';
		errorMsg = '';
		copyProgress = { done: 0, total: 0 };
		timings = {};

		try {
			const dirHandle = await loadFsHandle();
			if (!dirHandle)
				throw new Error(
					'No filesystem handle found. Please open a directory in the Filesystem Sync page first.'
				);

			const permission = await (dirHandle as any).requestPermission({ mode: 'read' });
			if (permission !== 'granted') throw new Error('Read permission denied for directory.');

			statusMsg = 'Scanning .bean files…';
			const files: Array<{ path: string; handle: FileSystemFileHandle }> = [];
			await scanFsBeanFiles(dirHandle, '', files);
			copyProgress.total = files.length;
			statusMsg = `Found ${files.length} .bean files. Copying…`;

			let overwriteAll = false;
			const t0 = performance.now();

			for (const { path, handle } of files) {
				const exists = await opfsFileExists(path);
				if (exists && !overwriteAll) {
					const choice = await waitForOverwriteChoice(path);
					if (choice === 'skip') {
						copyProgress.done++;
						continue;
					}
					if (choice === 'overwriteAll') {
						overwriteAll = true;
					}
				}
				const file = await handle.getFile();
				const content = await file.text();
				await writeOpfsFile(path, content);
				copyProgress.done++;
				statusMsg = `Copied ${copyProgress.done} / ${copyProgress.total}`;
			}

			timings.copy = Math.round(performance.now() - t0);
			phase = 'copied';
			statusMsg = `Done. ${copyProgress.done} files copied in ${timings.copy} ms.`;
		} catch (e: any) {
			errorMsg = e?.message ?? String(e);
			phase = 'error';
		}
	}

	// ── Load ledger from OPFS ─────────────────────────────────────────────────────
	async function loadLedger() {
		phase = 'loading';
		statusMsg = 'Initializing WASM…';
		errorMsg = '';

		try {
			await ensureInitialized();

			statusMsg = 'Reading files from OPFS…';
			const t0 = performance.now();

			const fileMap = new Map<string, string>();
			const root = await navigator.storage.getDirectory();
			await collectOpfsBeanFiles(root, '', fileMap);

			if (fileMap.size === 0) throw new Error('No .bean files found in OPFS. Copy files first.');

			const externalBook = await settings.get<string>(SettingKeys.externalBook);
			if (!externalBook)
				throw new Error('No externalBook setting found. Configure it in Settings.');

			// externalBook is stored as "dirname/filename.bean"; strip the directory prefix.
			const parts = externalBook.split('/');
			const mainFileName = parts[parts.length - 1];

			if (!fileMap.has(mainFileName)) {
				throw new Error(
					`Main file "${mainFileName}" not found in OPFS. Keys: ${[...fileMap.keys()].slice(0, 5).join(', ')}…`
				);
			}

			statusMsg = `Parsing ${fileMap.size} files…`;
			const record: Record<string, string> = Object.fromEntries(fileMap);
			const l = createLedger(record, mainFileName);
			timings.load = Math.round(performance.now() - t0);

			if (ledger) ledger.free();
			ledger = l;

			const directives = ledger.getDirectives();
			directiveCount = directives.length;
			const errors = ledger.getErrors();

			phase = 'loaded';
			statusMsg = `Ledger loaded in ${timings.load} ms — ${directiveCount} directives${errors.length ? `, ${errors.length} error(s)` : ''}.`;
		} catch (e: any) {
			errorMsg = e?.message ?? String(e);
			phase = 'error';
		}
	}

	// ── Query ─────────────────────────────────────────────────────────────────────
	async function runQuery() {
		if (!ledger) return;
		queryRunning = true;
		queryResult = null;
		try {
			const result = ledger.query(bql);
			queryResult = {
				columns: result.columns ?? [],
				rows: result.rows ?? [],
				errors: result.errors ?? []
			};
		} catch (e: any) {
			queryResult = { columns: [], rows: [], errors: [{ message: e?.message ?? String(e) }] };
		} finally {
			queryRunning = false;
		}
	}

	function formatCell(value: any): string {
		if (value == null) return '';
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
			return String(value);
		try {
			return JSON.stringify(value, null, 1);
		} catch {
			return String(value);
		}
	}

    function onOpfsClick() {
        goto('/demo/opfs');
    }
</script>

<main class="flex flex-col flex-1">
	<Toolbar title="OPFS Sync Test">
		{#snippet menuItems()}
			<ToolbarMenuItem text="OPFS Storage" Icon={BoxIcon} onclick={onOpfsClick} />
		{/snippet}
	</Toolbar>

	<div class="p-4 flex flex-col gap-6 max-w-4xl">
		<h1 class="text-xl font-semibold">OPFS Load Test</h1>
		<p class="text-sm text-base-content/60">
			Hypothesis: parsing the full ledger from OPFS is faster than from the File System API.
		</p>

		<!-- Step 1: Copy files -->
		<section class="card bg-base-200 p-4 flex flex-col gap-3">
			<h2 class="font-semibold">Step 1 — Copy .bean files to OPFS</h2>
			<p class="text-sm text-base-content/60">
				Reads all <code>.bean</code> files recursively from the selected filesystem directory and copies
				them into OPFS, preserving folder structure.
			</p>
			<div class="flex gap-2 items-center">
				<button
					class="btn btn-primary btn-sm"
					onclick={copyFilesToOpfs}
					disabled={phase === 'copying' || phase === 'loading'}
				>
					{#if phase === 'copying'}
						<span class="loading loading-spinner loading-xs"></span> Copying…
					{:else}
						Copy files to OPFS
					{/if}
				</button>
				{#if timings.copy !== undefined}
					<span class="text-sm text-base-content/60">Copy: {timings.copy} ms</span>
				{/if}
			</div>

			{#if copyProgress.total > 0 && phase === 'copying'}
				<progress
					class="progress progress-primary w-full"
					value={copyProgress.done}
					max={copyProgress.total}
				></progress>
			{/if}

			{#if statusMsg && (phase === 'copying' || phase === 'copied')}
				<p class="text-sm">{statusMsg}</p>
			{/if}
		</section>

		<!-- Step 2: Load ledger -->
		<section class="card bg-base-200 p-4 flex flex-col gap-3">
			<h2 class="font-semibold">Step 2 — Load Ledger from OPFS</h2>
			<p class="text-sm text-base-content/60">
				Creates a multi-file Ledger instance from the OPFS files. Entry point is taken from the <code
					>externalBook</code
				> setting.
			</p>
			<div class="flex gap-2 items-center flex-wrap">
				<button
					class="btn btn-secondary btn-sm"
					onclick={loadLedger}
					disabled={phase === 'copying' || phase === 'loading'}
				>
					{#if phase === 'loading'}
						<span class="loading loading-spinner loading-xs"></span> Loading…
					{:else}
						Load Ledger
					{/if}
				</button>
				{#if timings.load !== undefined}
					<span class="text-sm text-base-content/60">Load: {timings.load} ms</span>
				{/if}
				{#if directiveCount > 0}
					<span class="badge badge-ghost">{directiveCount.toLocaleString()} directives</span>
				{/if}
			</div>

			{#if statusMsg && (phase === 'loading' || phase === 'loaded')}
				<p class="text-sm">{statusMsg}</p>
			{/if}

			{#if timings.copy !== undefined && timings.load !== undefined}
				<div class="stats stats-horizontal bg-base-100 shadow text-sm mt-1">
					<div class="stat py-2 px-4">
						<div class="stat-title text-xs">Files copied</div>
						<div class="stat-value text-base">{copyProgress.done}</div>
						<div class="stat-desc">{timings.copy} ms</div>
					</div>
					<div class="stat py-2 px-4">
						<div class="stat-title text-xs">Directives parsed</div>
						<div class="stat-value text-base">{directiveCount.toLocaleString()}</div>
						<div class="stat-desc">{timings.load} ms total (read + parse)</div>
					</div>
				</div>
			{/if}
		</section>

		<!-- Error -->
		{#if phase === 'error' && errorMsg}
			<div class="alert alert-error text-sm">
				<span>{errorMsg}</span>
			</div>
		{/if}

		<!-- Step 3: Query panel -->
		{#if phase === 'loaded' && ledger}
			<section class="card bg-base-200 p-4 flex flex-col gap-3">
				<h2 class="font-semibold">Step 3 — Run BQL Query</h2>
				<textarea
					class="textarea textarea-bordered w-full font-mono text-sm h-24"
					placeholder="Enter BQL query…"
					bind:value={bql}
					onkeydown={(e) => e.key === 'Enter' && e.ctrlKey && runQuery()}
				></textarea>
				<div class="flex gap-2 items-center">
					<button class="btn btn-primary btn-sm" onclick={runQuery} disabled={queryRunning}>
						{#if queryRunning}
							<span class="loading loading-spinner loading-xs"></span> Running…
						{:else}
							Run (Ctrl+Enter)
						{/if}
					</button>
					{#if queryResult}
						<span class="text-sm text-base-content/60">{queryResult.rows.length} rows</span>
					{/if}
				</div>

				{#if queryResult}
					{#if queryResult.errors.length > 0}
						<div class="border border-error rounded bg-error/10 p-3 text-sm text-error font-mono">
							{#each queryResult.errors as err}
								<div>{err.message}</div>
							{/each}
						</div>
					{/if}
					{#if queryResult.columns.length > 0}
						<div class="overflow-x-auto">
							<table class="table table-sm table-zebra w-full">
								<thead>
									<tr>
										{#each queryResult.columns as col}
											<th>{col}</th>
										{/each}
									</tr>
								</thead>
								<tbody>
									{#each queryResult.rows as row}
										<tr>
											{#each queryResult.columns as _col, i}
												<td class="font-mono text-xs whitespace-pre-wrap">{formatCell(row[i])}</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				{/if}
			</section>
		{/if}
	</div>
</main>

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
