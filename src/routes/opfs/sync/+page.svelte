<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { FolderOpenIcon, RefreshCcwIcon, ArrowLeftIcon, ArrowRightIcon, PlayIcon, MinusIcon } from '@lucide/svelte';
	import { settings, SettingKeys } from '$lib/settings';
	import fullLedgerService from '$lib/services/ledgerWorkerClient';
	import {
		loadPersistedHandle,
		persistHandle,
		requestReadPermission,
		requestWritePermission
	} from '$lib/utils/fsHandleStore';
	import { getManifest, putManifestEntry, type ImportedFileMeta } from '$lib/utils/importManifest';
	import * as OpfsLib from '$lib/utils/opfslib.js';
	import { parseSpecs, collectFsFileHandles } from '$lib/utils/fsScan';
	import { processWithConcurrencyLimit } from '$lib/utils/concurrency';

	const HANDLE_KEY = 'importLedgerDirectoryHandle';
	const CONCURRENCY = 4;

	// ── Types ─────────────────────────────────────────────────────────────────────
	type SyncAction = 'fs-to-opfs' | 'opfs-to-fs' | 'conflict' | 'skip';

	type SyncEntry = {
		path: string;
		opfsLastModified?: number;
		fsLastModified?: number;
		defaultAction: SyncAction;
		action: SyncAction;
	};

	// ── FS write helper ───────────────────────────────────────────────────────────
	async function writeFsFile(
		rootHandle: FileSystemDirectoryHandle,
		path: string,
		content: string
	): Promise<void> {
		const parts = path.split('/');
		const fileName = parts.pop()!;
		let dir = rootHandle;
		for (const part of parts) {
			dir = await dir.getDirectoryHandle(part, { create: true });
		}
		const fh = await dir.getFileHandle(fileName, { create: true });
		const writable = await fh.createWritable();
		await writable.write(new TextEncoder().encode(content));
		await writable.close();
	}

	// ── State ─────────────────────────────────────────────────────────────────────
	let dirHandle = $state<FileSystemDirectoryHandle | null>(null);
	let dirName = $state('');
	let fileSpec = $state('*.bean, *.toml');
	let hasDirectoryPicker = $state(false);
	let hasWritePermission = $state(false);
	let phase = $state<'idle' | 'scanning' | 'syncing' | 'done' | 'error'>('idle');
	let syncEntries = $state<SyncEntry[]>([]);
	let progress = $state({ done: 0, total: 0 });
	let errorMsg = $state('');
	let logLines = $state<string[]>([]);
	let consoleEl = $state<HTMLDivElement | null>(null);
	let reloadPhase = $state<'idle' | 'reloading' | 'done' | 'error'>('idle');
	let reloadError = $state('');

	$effect(() => {
		if (logLines.length && consoleEl) {
			consoleEl.scrollTop = consoleEl.scrollHeight;
		}
	});

	let actionableCount = $derived(
		syncEntries.filter((e) => e.action === 'fs-to-opfs' || e.action === 'opfs-to-fs').length
	);
	let conflictCount = $derived(syncEntries.filter((e) => e.action === 'conflict').length);

	function cycleAction(path: string) {
		const idx = syncEntries.findIndex((e) => e.path === path);
		if (idx === -1) return;
		const current = syncEntries[idx].action;
		const next: SyncAction =
			current === 'conflict' || current === 'skip' ? 'fs-to-opfs'
			: current === 'fs-to-opfs' ? 'opfs-to-fs'
			: 'skip';
		syncEntries[idx] = { ...syncEntries[idx], action: next };
	}

	function isOverridden(entry: SyncEntry): boolean {
		const norm = (a: SyncAction) => (a === 'conflict' ? 'skip' : a);
		return norm(entry.action) !== norm(entry.defaultAction);
	}

	onMount(async () => {
		hasDirectoryPicker = 'showDirectoryPicker' in window;
		dirName = (await settings.get<string>(SettingKeys.importBookDirectory)) ?? '';
		fileSpec = (await settings.get<string>(SettingKeys.importBookFileSpec)) ?? fileSpec;
		if (hasDirectoryPicker) {
			const stored = await loadPersistedHandle(HANDLE_KEY);
			if (stored && (await requestReadPermission(stored))) {
				dirHandle = stored;
				hasWritePermission = await requestWritePermission(stored);
			}
		}
	});

	async function pickDirectory() {
		try {
			const handle = await (
				window as unknown as {
					showDirectoryPicker: (opts: { mode: string }) => Promise<FileSystemDirectoryHandle>;
				}
			).showDirectoryPicker({ mode: 'readwrite' });
			dirHandle = handle;
			dirName = handle.name;
			hasWritePermission = true;
			await settings.set(SettingKeys.importBookDirectory, dirName);
			await persistHandle(HANDLE_KEY, handle);
			phase = 'idle';
			errorMsg = '';
			logLines = [];
			syncEntries = [];
		} catch (e) {
			const err = e as { name?: string; message?: string };
			if (err?.name !== 'AbortError') errorMsg = err?.message ?? String(e);
		}
	}

	// ── Scan ──────────────────────────────────────────────────────────────────────
	async function scan() {
		if (!dirHandle) return;

		phase = 'scanning';
		errorMsg = '';
		syncEntries = [];

		try {
			const patterns = parseSpecs(fileSpec);
			if (patterns.length === 0) throw new Error('No valid file specs provided.');

			const fsHandles: Array<{ path: string; handle: FileSystemFileHandle }> = [];
			await collectFsFileHandles(dirHandle, '', patterns, fsHandles);

			const [manifest, fsMetaList] = await Promise.all([
				getManifest(),
				Promise.all(
					fsHandles.map(async ({ path, handle }) => {
						const file = await handle.getFile();
						return { path, handle, lastModified: file.lastModified, size: file.size };
					})
				)
			]);

			const fsFiles = new Map(fsMetaList.map((f) => [f.path, f]));
			const result: SyncEntry[] = [];

			for (const [path, fsEntry] of fsFiles) {
				const meta = manifest.get(path);
				const opfsMeta = await OpfsLib.getFileMetadata(path);

				const fsChanged = !meta || fsEntry.lastModified !== meta.lastModified || fsEntry.size !== meta.size;
				const opfsChanged = opfsMeta && meta ? opfsMeta.lastModified > meta.importedAt : false;

				if (!fsChanged && !opfsChanged) continue;

				const defaultAction: SyncAction =
					fsChanged && opfsChanged ? 'conflict' : fsChanged ? 'fs-to-opfs' : 'opfs-to-fs';
				result.push({
					path,
					opfsLastModified: opfsMeta?.lastModified,
					fsLastModified: fsEntry.lastModified,
					defaultAction,
					action: defaultAction
				});
			}

			result.sort((a, b) => a.path.localeCompare(b.path));
			syncEntries = result;
			phase = 'idle';
		} catch (e) {
			errorMsg = (e as { message?: string }).message ?? String(e);
			phase = 'error';
		}
	}

	// ── Sync ──────────────────────────────────────────────────────────────────────
	async function runSync() {
		if (!dirHandle) return;
		const toSync = syncEntries.filter((e) => e.action === 'fs-to-opfs' || e.action === 'opfs-to-fs');
		if (toSync.length === 0) return;

		phase = 'syncing';
		errorMsg = '';
		logLines = [];
		progress = { done: 0, total: toSync.length };

		try {
			const patterns = parseSpecs(fileSpec);
			const fsHandles: Array<{ path: string; handle: FileSystemFileHandle }> = [];
			await collectFsFileHandles(dirHandle, '', patterns, fsHandles);
			const fsFiles = new Map(
				await Promise.all(
					fsHandles.map(async ({ path, handle }) => [path, handle] as const)
				)
			);

			await processWithConcurrencyLimit(toSync, CONCURRENCY, async (entry) => {
				if (entry.action === 'fs-to-opfs') {
					const handle = fsFiles.get(entry.path);
					if (!handle) return;
					const file = await handle.getFile();
					// write to OPFS
					const root = await navigator.storage.getDirectory();
					const parts = entry.path.split('/');
					let dir: FileSystemDirectoryHandle = root;
					for (const part of parts.slice(0, -1)) {
						dir = await dir.getDirectoryHandle(part, { create: true });
					}
					const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
					const writable = await fh.createWritable();
					await writable.write(file);
					await writable.close();
					await putManifestEntry({
						path: entry.path,
						size: file.size,
						lastModified: file.lastModified,
						importedAt: Date.now()
					} satisfies ImportedFileMeta);
					logLines = [...logLines, `← ${entry.path}`];
				} else if (entry.action === 'opfs-to-fs') {
					const content = await OpfsLib.readFile(entry.path);
					if (content === undefined) return;
					await writeFsFile(dirHandle!, entry.path, content);
					const meta = await OpfsLib.getFileMetadata(entry.path);
					if (meta) {
						await putManifestEntry({
							path: entry.path,
							size: meta.size,
							lastModified: meta.lastModified,
							importedAt: Date.now()
						} satisfies ImportedFileMeta);
					}
					logLines = [...logLines, `→ ${entry.path}`];
				}
				progress.done++;
			});

			phase = 'done';
			logLines = [...logLines, `Done — ${progress.done} / ${progress.total} synced.`];
		} catch (e) {
			errorMsg = (e as { message?: string }).message ?? String(e);
			phase = 'error';
		}
	}

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

	function formatDate(ms?: number): string {
		if (!ms) return '—';
		return new Date(ms).toLocaleString();
	}
</script>

<div class="h-screen flex flex-col overflow-hidden">
	<Toolbar title="Sync OPFS ↔ Filesystem" />

	<div class="flex-1 overflow-y-auto touch-pan-y p-4 flex flex-col gap-4">

		<!-- Directory picker -->
		<section class="flex flex-col gap-2">
			<label class="label font-semibold">Source Directory</label>
			<div class="flex items-center gap-2 flex-wrap">
				{#if dirName}
					<span class="font-mono text-sm bg-base-200 rounded px-3 py-2 flex-1 truncate">{dirName}/</span>
				{/if}
				{#if hasDirectoryPicker}
					<button class="btn btn-primary gap-2" onclick={pickDirectory}>
						<FolderOpenIcon class="w-5 h-5" />
						{dirName ? 'Change' : 'Select Directory'}
					</button>
				{/if}
				{#if dirHandle}
					<button
						class="btn btn-secondary gap-2"
						disabled={phase === 'scanning' || phase === 'syncing'}
						onclick={scan}
					>
						<RefreshCcwIcon class="w-4 h-4 {phase === 'scanning' ? 'animate-spin' : ''}" />
						Scan
					</button>
				{/if}
			</div>
			{#if dirHandle && !hasWritePermission}
				<p class="text-xs text-warning">
					Write permission not granted — OPFS → FS sync is disabled. Re-pick the directory to enable it.
				</p>
			{/if}
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
				onblur={async () => settings.set(SettingKeys.importBookFileSpec, fileSpec)}
			/>
		</section>

		<!-- Results table -->
		{#if phase === 'scanning'}
			<div class="flex items-center gap-2 text-sm text-base-content/70">
				<span class="loading loading-spinner loading-sm"></span>
				Scanning…
			</div>
		{:else if syncEntries.length > 0}
			<section class="flex flex-col gap-2">
				<div class="flex items-center gap-3 flex-wrap text-sm">
					<span class="font-semibold text-base-content/70">Changes:</span>
					{#if actionableCount > 0}
						<span class="badge badge-success">{actionableCount} to sync</span>
					{/if}
					{#if conflictCount > 0}
						<span class="badge badge-error">{conflictCount} conflict{conflictCount > 1 ? 's' : ''}</span>
					{/if}
				</div>

				<div class="overflow-x-auto">
					<table class="table table-sm table-zebra w-full">
						<thead>
							<tr>
								<th class="w-[45%]">OPFS</th>
								<th class="w-[10%] text-center"></th>
								<th class="w-[45%]">Filesystem</th>
							</tr>
						</thead>
						<tbody>
							{#each syncEntries as entry}
								{@const isConflict = entry.action === 'conflict'}
								{@const isSkip = entry.action === 'skip'}
								{@const opfsIsSource = entry.action === 'opfs-to-fs'}
								{@const fsIsSource = entry.action === 'fs-to-opfs'}
								{@const overridden = isOverridden(entry)}
								<tr class="{isConflict ? 'opacity-60' : ''} {overridden ? 'bg-warning/15' : ''}">
									<!-- OPFS column -->
									<td class="font-mono text-xs {fsIsSource ? 'opacity-40' : ''}">
										<div class="truncate max-w-[18rem]">{entry.path}</div>
										<div class="text-base-content/50 text-[10px]">{formatDate(entry.opfsLastModified)}</div>
									</td>

									<!-- Arrow / X / skip column — clickable -->
									<td class="text-center">
										<button
											class="btn btn-ghost btn-xs p-0 w-8 h-8"
											onclick={() => cycleAction(entry.path)}
											title="Click to change action"
										>
											{#if isConflict}
												<span class="text-error font-bold text-base leading-none">✕</span>
											{:else if isSkip}
												<MinusIcon class="w-4 h-4 text-base-content/40 mx-auto" />
											{:else if opfsIsSource}
												<ArrowRightIcon class="w-5 h-5 text-success mx-auto" />
											{:else}
												<ArrowLeftIcon class="w-5 h-5 text-success mx-auto" />
											{/if}
										</button>
									</td>

									<!-- FS column -->
									<td class="font-mono text-xs {opfsIsSource ? 'opacity-40' : ''}">
										<div class="truncate max-w-[18rem]">{entry.path}</div>
										<div class="text-base-content/50 text-[10px]">{formatDate(entry.fsLastModified)}</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{:else if phase === 'idle' && dirHandle}
			<p class="text-sm text-base-content/50">No changes detected. Everything is in sync.</p>
		{/if}

		<!-- Sync button -->
		{#if actionableCount > 0 && phase !== 'syncing' && phase !== 'done'}
			<center class="py-4">
				<button
					class="btn btn-accent"
					disabled={phase === 'scanning'}
					onclick={runSync}
				>
					<PlayIcon class="w-4 h-4" />
					Sync {actionableCount} file{actionableCount > 1 ? 's' : ''}
				</button>
				{#if conflictCount > 0}
					<p class="text-xs text-base-content/50 mt-2">{conflictCount} conflicted file{conflictCount > 1 ? 's' : ''} will be skipped.</p>
				{/if}
			</center>
		{/if}

		<!-- Progress -->
		{#if phase === 'syncing' && progress.total > 0}
			<progress class="progress progress-primary w-full" value={progress.done} max={progress.total}></progress>
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

		{#if phase === 'done'}
			<div class="alert alert-success text-sm">
				<span>Sync complete.</span>
			</div>
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

		{#if errorMsg}
			<div class="alert alert-error text-sm">
				<span>{errorMsg}</span>
			</div>
		{/if}

	</div>
</div>
