<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import HelpButton from '$lib/help/HelpButton.svelte';
	import { FolderOutputIcon, RefreshCcwIcon, DownloadIcon } from '@lucide/svelte';
	import { deviceSettings, DeviceSettingKeys } from '$lib/settings';
	import {
		loadPersistedHandle,
		persistHandle,
		requestWritePermission
	} from '$lib/utils/fsHandleStore';
	import {
		collectExportableFiles,
		exportEntriesToDirectory,
		exportEntriesToZip,
		type ExportFileEntry
	} from '$lib/utils/opfsExport';

	const HANDLE_KEY = 'exportLedgerDirectoryHandle';

	// ── State ─────────────────────────────────────────────────────────────────────
	type Phase = 'idle' | 'scanning' | 'exporting' | 'done' | 'error';

	let hasDirectoryPicker = $state(false);
	let dirHandle = $state<FileSystemDirectoryHandle | null>(null);
	let dirName = $state('');
	let phase = $state<Phase>('idle');
	let entries = $state<ExportFileEntry[]>([]);
	let progress = $state({ done: 0, total: 0 });
	let statusMsg = $state('');
	let errorMsg = $state('');
	let logLines = $state<string[]>([]);
	let consoleEl = $state<HTMLDivElement | null>(null);
	let hourglassTick = $state(0);

	let totalBytes = $derived(entries.reduce((sum, e) => sum + e.size, 0));

	$effect(() => {
		let timer: ReturnType<typeof setInterval> | null = null;
		if (phase === 'exporting') {
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

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		const units = ['KB', 'MB', 'GB'];
		let value = bytes / 1024;
		let unitIndex = 0;
		while (value >= 1024 && unitIndex < units.length - 1) {
			value /= 1024;
			unitIndex++;
		}
		return `${value.toFixed(1)} ${units[unitIndex]}`;
	}

	onMount(async () => {
		hasDirectoryPicker = 'showDirectoryPicker' in window;
		if (hasDirectoryPicker) {
			dirName = (await deviceSettings.get<string>(DeviceSettingKeys.exportBookDirectory)) ?? '';
			const stored = await loadPersistedHandle(HANDLE_KEY);
			if (stored && (await requestWritePermission(stored))) {
				dirHandle = stored;
			}
		}
		await scan();
	});

	async function pickDirectory() {
		try {
			const handle = await (
				window as unknown as {
					showDirectoryPicker: (opts: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
				}
			).showDirectoryPicker({ mode: 'readwrite' });
			dirHandle = handle;
			dirName = handle.name;
			await deviceSettings.set(DeviceSettingKeys.exportBookDirectory, dirName);
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

	// ── Scan ──────────────────────────────────────────────────────────────────────
	async function scan(retrying = false) {
		phase = 'scanning';
		errorMsg = '';
		try {
			entries = await collectExportableFiles();
			phase = 'idle';
		} catch (e) {
			if (!retrying) {
				// The very first scan can race the root layout's concurrent OPFS
				// initialization (e.g. cashier.bean being created) — retry once
				// before surfacing a transient error to the user.
				await scan(true);
				return;
			}
			const err = e as { message?: string };
			errorMsg = err?.message ?? String(e);
			phase = 'error';
		}
	}

	// ── Export ────────────────────────────────────────────────────────────────────
	async function exportNow() {
		if (entries.length === 0) return;

		phase = 'exporting';
		errorMsg = '';
		statusMsg = '';
		logLines = [];
		progress = { done: 0, total: entries.length };

		try {
			if (hasDirectoryPicker && dirHandle) {
				await exportEntriesToDirectory(dirHandle, entries, (done, total, path) => {
					progress = { done, total };
					logLines = [...logLines, path];
				});
				statusMsg = `Done — ${entries.length} file(s) written to ${dirName}/.`;
			} else {
				const zipped = await exportEntriesToZip(entries, (done, total, path) => {
					progress = { done, total };
					logLines = [...logLines, path];
				});
				const blob = new Blob([zipped], { type: 'application/zip' });
				const url = URL.createObjectURL(blob);
				const stamp = new Date().toISOString().slice(0, 10);
				const a = document.createElement('a');
				a.href = url;
				a.download = `cashier-export-${stamp}.zip`;
				document.body.appendChild(a);
				a.click();
				a.remove();
				URL.revokeObjectURL(url);
				statusMsg = `Done — ${entries.length} file(s) packed into cashier-export-${stamp}.zip.`;
			}

			phase = 'done';
			logLines = [...logLines, statusMsg];
		} catch (e) {
			const err = e as { message?: string };
			errorMsg = err?.message ?? String(e);
			phase = 'error';
		}
	}
</script>

<div class="h-screen flex flex-col overflow-hidden">
	<Toolbar title="Export Ledger from OPFS">
		{#snippet actions()}
			<HelpButton topic="ledger-export" />
		{/snippet}
	</Toolbar>

	<div class="flex-1 overflow-y-auto touch-pan-y p-4 flex flex-col gap-4">
		{#if hasDirectoryPicker}
			<!-- Destination picker -->
			<section class="flex flex-col gap-2">
				<label for="directoryPicker" class="label font-semibold">Destination Directory</label>
				<div class="flex items-center gap-2">
					<span
						class="font-mono text-sm bg-base-200 rounded px-3 py-2 flex-1 truncate {dirName
							? ''
							: 'text-base-content/40'}">{dirName ? dirName + '/' : 'Not selected'}</span
					>
					<button id="directoryPicker" class="btn btn-primary gap-2" onclick={pickDirectory}>
						<FolderOutputIcon class="w-5 h-5" />
						{dirName ? 'Change' : 'Select Destination'}
					</button>
				</div>
				<p class="text-xs text-base-content/50">
					Files are written into this folder, overwriting matches by path. Nothing already there is
					deleted — this is a one-way copy, not a mirror.
				</p>
			</section>
		{:else}
			<div class="alert alert-info text-sm">
				<span>
					This browser (e.g. Firefox) doesn't support picking a folder to write to directly. Cashier
					will pack everything into a ZIP file and download it instead — where the file lands
					depends on your browser's own download settings.
				</span>
			</div>
		{/if}

		<!-- Scan results -->
		<section class="flex flex-col gap-3">
			<div class="flex items-center gap-2 flex-wrap">
				<span class="text-sm font-semibold text-base-content/70">Ledger contents:</span>
				{#if phase === 'scanning'}
					<span class="loading loading-spinner loading-sm"></span>
				{:else}
					<span class="badge badge-ghost">{entries.length} file(s)</span>
					<span class="badge badge-ghost">{formatBytes(totalBytes)}</span>
					<button
						class="btn btn-ghost btn-xs gap-1"
						disabled={phase === 'exporting'}
						onclick={() => scan()}
					>
						<RefreshCcwIcon class="w-3 h-3" />
						Rescan
					</button>
				{/if}
			</div>
			<p class="text-xs text-base-content/50">
				Everything in OPFS is exported except <code>.cashier/</code> (Cashier's internal cache) and
				<code>cashier.bean</code> (the on-device transaction store).
			</p>

			<!-- File preview list -->
			{#if entries.length > 0}
				<div
					class="overflow-y-auto border border-base-300 rounded font-mono text-xs"
					style="max-height: 8rem;"
				>
					{#each entries as file}
						<div class="flex items-center gap-2 px-2 py-0.5 hover:bg-base-200">
							<span class="truncate flex-1">{file.path}</span>
							<span class="text-base-content/40 shrink-0">{formatBytes(file.size)}</span>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<hr class="my-6 mx-4" />

		<!-- Export button -->
		<center class="py-4">
			<button
				class="btn btn-accent text-secondary gap-2"
				disabled={phase === 'exporting' ||
					phase === 'scanning' ||
					entries.length === 0 ||
					(hasDirectoryPicker && !dirHandle)}
				onclick={exportNow}
			>
				{#if hasDirectoryPicker}
					<FolderOutputIcon class="w-4 h-4" />
					Export to Folder
				{:else}
					<DownloadIcon class="w-4 h-4" />
					Export as ZIP
				{/if}
				{#if entries.length > 0}
					<span class="badge badge-sm">{entries.length}</span>
				{/if}
			</button>
			{#if phase === 'exporting'}
				<div class="mt-3 text-2xl" aria-label="Working…">
					{hourglassTick % 2 === 0 ? '⏳' : '⌛'}
				</div>
			{/if}
		</center>

		<!-- Progress -->
		{#if phase === 'exporting' && progress.total > 0}
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

		{#if phase === 'error' && errorMsg}
			<div class="alert alert-error text-sm">
				<span>{errorMsg}</span>
			</div>
		{/if}
	</div>
</div>
