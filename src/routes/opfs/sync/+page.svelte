<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import RefreshCcwIcon from '@lucide/svelte/icons/refresh-ccw';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import PlayIcon from '@lucide/svelte/icons/play';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import { settings, SettingKeys, deviceSettings, DeviceSettingKeys } from '#lib/settings';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import FolderApiNotice from '#lib/components/FolderApiNotice.svelte';
	import {
		loadPersistedHandle,
		persistHandle,
		hasPermission,
		requestWritePermission
	} from '#lib/utils/fsHandleStore';
	import {
		getReconciledManifest,
		putManifestEntries,
		type ImportedFileMeta
	} from '#lib/utils/importManifest';
	import * as OpfsLib from '#lib/utils/opfslib.js';
	import { parseSpecs, collectFsFileHandles } from '#lib/utils/fsScan';
	import { classifyFile, type FileStatus } from '#lib/utils/importScan';
	import { reloadLedgerFromOpfs } from '#lib/services/ledgerReload';

	let scannedFsHandles = $state(new Map<string, FileSystemFileHandle>());
	import { processWithConcurrencyLimit } from '#lib/utils/concurrency';

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

	const DEFAULT_ACTIONS: Record<Exclude<FileStatus, 'identical' | 'deleted'>, SyncAction> = {
		new: 'fs-to-opfs',
		modified: 'fs-to-opfs',
		local: 'opfs-to-fs',
		conflict: 'conflict'
	};

	// ── FS write helper ───────────────────────────────────────────────────────────
	/** Returns the file as written. */
	async function writeFsFile(
		rootHandle: FileSystemDirectoryHandle,
		path: string,
		content: string
	): Promise<File> {
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
		return fh.getFile();
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
			current === 'conflict' || current === 'skip'
				? 'fs-to-opfs'
				: current === 'fs-to-opfs'
					? 'opfs-to-fs'
					: 'skip';
		syncEntries[idx] = { ...syncEntries[idx], action: next };
	}

	function isOverridden(entry: SyncEntry): boolean {
		const norm = (a: SyncAction) => (a === 'conflict' ? 'skip' : a);
		return norm(entry.action) !== norm(entry.defaultAction);
	}

	onMount(async () => {
		hasDirectoryPicker = 'showDirectoryPicker' in window;
		dirName = (await deviceSettings.get<string>(DeviceSettingKeys.importBookDirectory)) ?? '';
		fileSpec = (await settings.get<string>(SettingKeys.importBookFileSpec)) ?? fileSpec;
		if (hasDirectoryPicker) {
			storedHandle = await loadPersistedHandle(HANDLE_KEY);
			if (storedHandle && (await hasPermission(storedHandle, 'read'))) {
				hasWritePermission = await hasPermission(storedHandle, 'readwrite');
				dirHandle = storedHandle;
			}
		}
		handleChecked = true;
	});

	// A folder name is known (e.g. restored from a backup) but the browser holds no access to it.
	let handleChecked = $state(false);
	const handleMissing = $derived(handleChecked && hasDirectoryPicker && !!dirName && !dirHandle);

	// The folder picked on an earlier visit; access to it may need to be granted again.
	let storedHandle = $state.raw<FileSystemDirectoryHandle | null>(null);

	// Asking for write access covers reading too.
	async function reconnect() {
		if (!storedHandle) return;
		errorMsg = '';
		if (await requestWritePermission(storedHandle)) {
			dirHandle = storedHandle;
			hasWritePermission = true;
		} else {
			errorMsg = 'Write access was not granted. Try again or select the folder.';
		}
	}

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
			await deviceSettings.set(DeviceSettingKeys.importBookDirectory, dirName);
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
			await collectFsFileHandles(dirHandle, '', patterns, (path, handle) => {
				fsHandles.push({ path, handle });
			});
			scannedFsHandles = new Map(fsHandles.map(({ path, handle }) => [path, handle]));

			const tree = await OpfsLib.listFileTree();
			const opfsFiles = new Map(tree.filter((e) => e.kind === 'file').map((e) => [e.path, e]));
			const manifest = await getReconciledManifest(opfsFiles.keys());

			const result: SyncEntry[] = [];
			const identical: ImportedFileMeta[] = [];

			await Promise.all(
				fsHandles.map(async ({ path, handle }) => {
					const file = await handle.getFile();
					const opfs = opfsFiles.get(path);
					const { status, record } = await classifyFile(
						file,
						manifest.get(path),
						opfs,
						async () => [await file.text(), (await OpfsLib.readFile(path)) ?? '']
					);
					if (record) {
						identical.push({
							path,
							size: file.size,
							lastModified: file.lastModified,
							importedAt: Date.now()
						});
					}
					if (status === 'identical') return;

					const defaultAction = DEFAULT_ACTIONS[status];
					result.push({
						path,
						opfsLastModified: opfs?.lastModified,
						fsLastModified: file.lastModified,
						defaultAction,
						action: defaultAction
					});
				})
			);

			if (identical.length) await putManifestEntries(identical);
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
		const toSync = syncEntries.filter(
			(e) => e.action === 'fs-to-opfs' || e.action === 'opfs-to-fs'
		);
		if (toSync.length === 0) return;

		phase = 'syncing';
		errorMsg = '';
		logLines = [];
		progress = { done: 0, total: toSync.length };

		try {
			const fsFiles = scannedFsHandles;
			const manifestEntries: ImportedFileMeta[] = [];

			await processWithConcurrencyLimit(toSync, CONCURRENCY, async (entry) => {
				if (entry.action === 'fs-to-opfs') {
					const handle = fsFiles.get(entry.path);
					if (!handle) return;
					const file = await handle.getFile();
					// Same canonical line endings as every other write into OPFS, so sync
					// compares equal across devices.
					await OpfsLib.saveBinaryFile(entry.path, new Uint8Array(await file.arrayBuffer()));
					manifestEntries.push({
						path: entry.path,
						size: file.size,
						lastModified: file.lastModified,
						importedAt: Date.now()
					} satisfies ImportedFileMeta);
					logLines = [...logLines, `← ${entry.path}`];
				} else if (entry.action === 'opfs-to-fs') {
					const content = await OpfsLib.readFile(entry.path);
					if (content === undefined) return;
					const written = await writeFsFile(dirHandle!, entry.path, content);
					manifestEntries.push({
						path: entry.path,
						size: written.size,
						lastModified: written.lastModified,
						importedAt: Date.now()
					} satisfies ImportedFileMeta);
					logLines = [...logLines, `→ ${entry.path}`];
				}
				progress.done++;
			});

			await putManifestEntries(manifestEntries);

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
			await reloadLedgerFromOpfs();
			reloadPhase = 'done';
		} catch (e) {
			const err = e as { message?: string };
			reloadError = err?.message ?? String(e);
			reloadPhase = 'error';
		}
	}

	function formatDate(ms: number | undefined = undefined): string {
		if (!ms) return '—';
		return new Date(ms).toLocaleString();
	}
</script>

<main class="h-screen flex flex-col overflow-hidden">
	<Toolbar title="Sync OPFS ↔ Filesystem">
		{#snippet actions()}
			<HelpButton topic="opfs-sync" />
		{/snippet}
	</Toolbar>

	<div class="flex-1 overflow-y-auto touch-pan-y p-4 flex flex-col gap-4">
		{#if handleChecked}
			<FolderApiNotice
				supported={hasDirectoryPicker}
				fallbackText="This page cannot work without it. Use Ledger Import and Ledger Export instead."
			/>
			{#if !hasDirectoryPicker}
				<div class="flex justify-center gap-4">
					<a href="/opfs/import-ledger" class="link">Ledger Import</a>
					<a href="/opfs/export-ledger" class="link">Ledger Export</a>
				</div>
			{/if}
		{/if}

		<!-- Directory picker -->
		<section class="flex flex-col gap-2">
			<span class="label font-semibold"
				>Source Directory{#if handleMissing}<span class="text-error"> (required)</span>{/if}</span
			>
			<div class="flex items-center gap-2 flex-wrap">
				{#if dirName}
					<span
						class="font-mono text-sm bg-base-200 rounded px-3 py-2 flex-1 truncate {handleMissing
							? 'outline outline-error'
							: ''}">{dirName}/</span
					>
				{/if}
				{#if storedHandle && (!dirHandle || (dirHandle === storedHandle && !hasWritePermission))}
					<button class="btn btn-warning" onclick={reconnect}>Reconnect</button>
				{/if}
				{#if hasDirectoryPicker}
					<button class="btn btn-primary gap-2" onclick={pickDirectory}>
						<FolderOpenIcon class="w-5 h-5" />
						{dirName ? 'Change' : 'Select Directory'}
					</button>
				{/if}
			</div>
			{#if dirHandle && !hasWritePermission}
				<p class="text-xs text-warning">
					Write permission not granted — OPFS → FS sync is disabled. Reconnect or re-pick the
					directory to enable it.
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

		{#if dirHandle}
			<center>
				<button
					class="btn btn-warning gap-2"
					disabled={phase === 'scanning' || phase === 'syncing'}
					onclick={scan}
				>
					<RefreshCcwIcon class="w-4 h-4 {phase === 'scanning' ? 'animate-spin' : ''}" />
					Scan
				</button>
			</center>
		{/if}

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
						<span class="badge badge-error"
							>{conflictCount} conflict{conflictCount > 1 ? 's' : ''}</span
						>
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
										<div class="text-base-content/50 text-[10px]">
											{formatDate(entry.opfsLastModified)}
										</div>
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
										<div class="text-base-content/50 text-[10px]">
											{formatDate(entry.fsLastModified)}
										</div>
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
				<button class="btn btn-accent" disabled={phase === 'scanning'} onclick={runSync}>
					<PlayIcon class="w-4 h-4" />
					Sync {actionableCount} file{actionableCount > 1 ? 's' : ''}
				</button>
				{#if conflictCount > 0}
					<p class="text-xs text-base-content/50 mt-2">
						{conflictCount} conflicted file{conflictCount > 1 ? 's' : ''} will be skipped.
					</p>
				{/if}
			</center>
		{/if}

		<!-- Progress -->
		{#if phase === 'syncing' && progress.total > 0}
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
</main>
