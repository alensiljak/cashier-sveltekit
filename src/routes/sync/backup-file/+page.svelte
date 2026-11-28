<script lang="ts">
	import Toolbar from '#lib/components/Toolbar.svelte';
	import DestroyStoreDialog from '#lib/components/DestroyStoreDialog.svelte';
	import { getReadyScxStore } from '#lib/services/scxService';
	import { getXactStore } from '#lib/storage/xactStoreRegistry';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import RestoredDeviceNotice from '#lib/components/RestoredDeviceNotice.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import * as BackupService from '#lib/services/backup';
	import { MIN_BACKUP_PASSPHRASE_LENGTH, checkPassphrase } from '#lib/services/backup/secrets';
	import Notifier from '#lib/utils/notifier';
	import FileDownIcon from '@lucide/svelte/icons/file-down';
	import Share2Icon from '@lucide/svelte/icons/share-2';
	import { onMount } from 'svelte';

	const SECTION_LABELS: Record<BackupService.BackupSection, { title: string; hint: string }> = {
		settings: { title: 'Settings', hint: 'accounts, groups, budget, formats, forecast and so on' },
		scx: { title: 'Scheduled transactions', hint: '' },
		workingSet: { title: 'Transactions', hint: 'the working set of new transactions' },
		device: {
			title: 'Device settings and sync configuration',
			hint: 'home cards, notifications, WebDAV / S3 / peer-sync options, folder names'
		},
		peers: {
			title: 'Trusted devices',
			hint: 'the peer-sync links, so you do not have to pair every device again'
		}
	};

	let _filename = $state<string>();

	// Backup options
	let selected = $state<BackupService.BackupSection[]>([...BackupService.ALL_SECTIONS]);
	let includeSecrets = $state(false);
	let passphrase = $state('');
	let passphraseAgain = $state('');
	let showPassphrase = $state(false);
	let busy = $state(false);

	// Restore state
	let restoreContent = $state<string>();
	let restoreName = $state('');
	let restoreInfo = $state<BackupService.BackupInfo>();
	let restoreSelected = $state<BackupService.BackupSection[]>([]);
	let restorePassphrase = $state('');
	let notice = $state<{ refresh: () => Promise<void> }>();
	let restoreMessages = $state<string[]>([]);
	/** What the restore would do to the transaction stores; undefined while that is worked out. */
	let preview = $state<BackupService.StoreOutcomes>();
	/** The stores that have something to destroy. */
	let withHistory = $state<BackupService.StoreSection[]>([]);
	let destroyTarget = $state<'xacts' | 'scx' | null>(null);

	const STORE_SECTIONS: BackupService.StoreSection[] = ['scx', 'workingSet'];
	const STORE_LABELS: Record<BackupService.StoreSection, string> = {
		scx: 'Scheduled transactions',
		workingSet: 'Transactions'
	};
	const DESTROY_TARGETS = { scx: 'scx', workingSet: 'xacts' } as const;

	/** The selected stores of the file that can be destroyed. */
	const destroyable = $derived(
		STORE_SECTIONS.filter((s) => restoreSelected.includes(s) && withHistory.includes(s))
	);

	Notifier.init();

	onMount(() => {
		_filename = BackupService.getBackupFilename();
	});

	function closeRestore() {
		restoreContent = restoreInfo = preview = undefined;
		restorePassphrase = '';
	}

	async function storesWithHistory(): Promise<BackupService.StoreSection[]> {
		const stores = { scx: await getReadyScxStore(), workingSet: await getXactStore() };
		const has = await Promise.all(STORE_SECTIONS.map((s) => stores[s].hasHistory()));
		return STORE_SECTIONS.filter((_, i) => has[i]);
	}

	/** Compares the chosen file with the stores as they are now. */
	async function refreshPreview() {
		const content = restoreContent;
		preview = undefined;
		if (!content) return;
		try {
			const [changes, history] = await Promise.all([
				BackupService.previewRestore(content),
				storesWithHistory()
			]);
			// Another file may have been chosen meanwhile.
			if (content !== restoreContent) return;
			preview = changes;
			withHistory = history;
		} catch (error) {
			console.error('Restore preview failed:', error);
			Notifier.error(
				`Could not compare the backup with this device: ${error instanceof Error ? error.message : error}`
			);
		}
	}

	async function onDestroyClosed() {
		const target = destroyTarget;
		destroyTarget = null;
		const before = withHistory;
		await refreshPreview();
		// What the last restore reported no longer applies to a destroyed store.
		const section = target === 'xacts' ? 'workingSet' : 'scx';
		if (before.includes(section) && !withHistory.includes(section)) restoreMessages = [];
	}

	function describePreview(outcome: BackupService.StoreOutcome | undefined): string {
		if (!outcome) return '';
		if (outcome.ignored) {
			return 'would be ignored: made before this store was reset. Destroy the store to use it';
		}
		const { added, changed, deleted } = outcome;
		if (added + changed + deleted === 0) return 'merged: would change nothing';
		return `merged: would add ${added}, change ${changed}, delete ${deleted} record(s)`;
	}

	/** Options for the backup, or undefined (with a message) when they are not usable. */
	function backupOptions(): BackupService.BackupOptions | undefined {
		if (selected.length === 0) {
			Notifier.info('Select what to back up');
			return undefined;
		}
		if (!includeSecrets) return { sections: selected };
		if (passphrase !== passphraseAgain) {
			Notifier.error('The two passphrases are different');
			return undefined;
		}
		try {
			checkPassphrase(passphrase);
		} catch (e) {
			Notifier.error((e as Error).message);
			return undefined;
		}
		return { sections: selected, secretsPassphrase: passphrase };
	}

	async function onBackupClick() {
		const options = backupOptions();
		if (!options) return;
		busy = true;
		try {
			await BackupService.createBackupFile(_filename as string, options);
		} catch (e) {
			Notifier.error(`Backup failed: ${e instanceof Error ? e.message : e}`);
		} finally {
			busy = false;
		}
	}

	async function onShareClick() {
		const options = backupOptions();
		if (!options) return;
		if (!navigator.share) {
			Notifier.error('Web Share API not supported.');
			return;
		}
		busy = true;
		try {
			const output = await BackupService.createBackup(options);
			const file = new File([output], _filename as string, { type: 'application/json' });
			if (navigator.canShare?.({ files: [file] })) {
				await navigator.share({ title: 'Cashier Backup', files: [file] });
			} else {
				await navigator.share({ title: 'Cashier Backup', text: output });
			}
		} catch (e) {
			if ((e as Error).name !== 'AbortError') {
				Notifier.error(`Backup failed: ${e instanceof Error ? e.message : e}`);
			}
		} finally {
			busy = false;
		}
	}

	function generatePassphrase() {
		// 24 characters from a 32-character alphabet: 120 bits.
		const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789_';
		const bytes = crypto.getRandomValues(new Uint8Array(24));
		const text = Array.from(bytes, (b) => alphabet[b % 32]).join('');
		passphrase = passphraseAgain = text;
		showPassphrase = true;
	}

	async function onFileChosen(file: File | undefined) {
		if (!file) return;
		closeRestore();
		restoreMessages = [];
		try {
			const content = await file.text();
			const info = BackupService.inspectBackup(content);
			restoreInfo = info;
			restoreContent = content;
			restoreName = file.name;
			restoreSelected = info.sections.filter((s) => s !== 'settings' || info.counts.settings > 0);
		} catch (error) {
			Notifier.error(
				`Cannot restore, existing data was kept: ${error instanceof Error ? error.message : error}`
			);
			return;
		}
		await refreshPreview();
	}

	async function onRestoreClick() {
		if (!restoreContent) return;
		restoreMessages = [];
		busy = true;
		try {
			const result = await BackupService.restoreBackup(restoreContent, {
				sections: restoreSelected,
				secretsPassphrase: restorePassphrase || undefined
			});
			restoreMessages = describe(result);
			const nothingAdded = STORE_SECTIONS.filter((s) => result.stores[s]?.added === 0);
			if (nothingAdded.length === 0) {
				Notifier.success('Backup restored');
				closeRestore();
			} else {
				// The file stays chosen, with Destroy at hand.
				Notifier.info(
					`Restore finished, but nothing was added to: ${nothingAdded.map((s) => STORE_LABELS[s].toLowerCase()).join(', ')}`
				);
				await refreshPreview();
			}
			await notice?.refresh();
		} catch (error) {
			console.error('Restore failed:', error);
			Notifier.error(
				`Restore failed, existing data was kept: ${error instanceof Error ? error.message : error}`
			);
		} finally {
			busy = false;
		}
	}

	const FIELD_NAMES: Record<string, string> = {
		'webdav.password': 'WebDAV password',
		's3.accessKeyId': 'S3 access key ID',
		's3.secretAccessKey': 'S3 secret access key',
		's3.passphrase': 'S3 encryption passphrase',
		'webdavEncryption.passphrase': 'WebDAV encryption passphrase'
	};

	function describeOutcome(outcome: BackupService.StoreOutcome): string {
		const toDestroy = "To return to the backup's state, destroy the store, then restore.";
		if (outcome.ignored) {
			return `ignored, as the backup was made before this store was reset. ${toDestroy}`;
		}
		if (outcome.postponed) {
			return 'not restored: you chose to wait with the reset the backup holds.';
		}
		const { added, changed, deleted } = outcome;
		if (added + changed + deleted === 0) {
			return `nothing changed. Merging does not undo later deletions or edits. ${toDestroy}`;
		}
		return `${added} added, ${changed} changed, ${deleted} deleted.`;
	}

	function describe(result: BackupService.RestoreResult): string[] {
		const out: string[] = [];
		for (const section of STORE_SECTIONS) {
			const outcome = result.stores[section];
			if (outcome) out.push(`${STORE_LABELS[section]}: ${describeOutcome(outcome)}`);
		}
		if (result.secrets === 'wrong-passphrase') {
			out.push(
				'The credentials were not restored: the passphrase did not fit. Everything else was restored. Restore the file again with the right passphrase to get them.'
			);
		}
		if (result.missing.length > 0) {
			out.push(
				'Still to enter (the pages mark them as required): ' +
					result.missing.map((id) => FIELD_NAMES[id] ?? id).join(', ') +
					'.'
			);
		}
		if (result.restored.includes('peers')) {
			out.push(
				'Trusted devices were restored, but the others do not know this device yet: pair it with one of them (Peer Sync → invite) and the rest are asked to approve it.'
			);
		}
		if (result.restored.includes('device')) {
			out.push(
				'Pick the import and export folders again on their pages (the browser does not keep access to folders).'
			);
		}
		return out;
	}
</script>

<main>
	<Toolbar title="Backup">
		{#snippet actions()}
			<HelpButton topic="backup" />
		{/snippet}
	</Toolbar>
	<div class="mx-auto max-w-2xl">
		<RestoredDeviceNotice bind:this={notice} />

		<section class="p-1">
			<h3 class="text-3xl font-semibold">Create Backup</h3>

			<p>Choose what to back up:</p>
			<ul class="mx-2 mt-1 space-y-1">
				{#each BackupService.ALL_SECTIONS as section (section)}
					<li>
						<label class="flex cursor-pointer items-start gap-2">
							<input
								type="checkbox"
								class="checkbox checkbox-sm mt-1"
								value={section}
								bind:group={selected}
							/>
							<span>
								{SECTION_LABELS[section].title}
								{#if SECTION_LABELS[section].hint}
									<span class="block text-xs opacity-60">{SECTION_LABELS[section].hint}</span>
								{/if}
							</span>
						</label>
					</li>
				{/each}
			</ul>

			<div class="mx-2 mt-4">
				<label class="flex cursor-pointer items-start gap-2">
					<input
						type="checkbox"
						class="toggle toggle-primary mt-0.5 bg-transparent bg-none"
						bind:checked={includeSecrets}
					/>
					<span>
						Include credentials, encrypted
						<span class="block text-xs opacity-60">
							WebDAV password, S3 keys, encryption passphrases, TURN credentials. Leave this off to
							keep them in a password manager: the file then holds everything else, and the pages
							ask for the missing ones after a restore.
						</span>
					</span>
				</label>

				{#if includeSecrets}
					<div class="mt-2 space-y-2">
						<input
							type={showPassphrase ? 'text' : 'password'}
							class="input input-bordered w-full font-mono"
							placeholder="Passphrase for this file ({MIN_BACKUP_PASSPHRASE_LENGTH}+ characters)"
							autocomplete="off"
							bind:value={passphrase}
						/>
						<input
							type={showPassphrase ? 'text' : 'password'}
							class="input input-bordered w-full font-mono"
							placeholder="Passphrase again"
							autocomplete="off"
							bind:value={passphraseAgain}
						/>
						<div class="flex flex-wrap items-center gap-2">
							<button type="button" class="btn btn-sm" onclick={generatePassphrase}>
								Generate a random one
							</button>
							<label class="flex cursor-pointer items-center gap-2 text-sm">
								<input type="checkbox" class="checkbox checkbox-xs" bind:checked={showPassphrase} />
								Show
							</label>
						</div>
						<p class="text-xs opacity-60">
							Use a long random passphrase and keep it in your password manager. Without it the
							credentials in the file cannot be recovered; the rest of the file can still be
							restored.
						</p>
					</div>
				{/if}
			</div>

			<p class="mt-4">into</p>

			<div class="flex flex-row">
				<input type="text" class="input" bind:value={_filename} readonly />
			</div>

			<center class="pt-4">
				<button
					type="button"
					class="btn btn-primary rounded"
					disabled={busy}
					onclick={onBackupClick}
				>
					<FileDownIcon />
					<span>Backup</span>
				</button>
				<button
					type="button"
					class="btn btn-primary rounded"
					disabled={busy}
					onclick={onShareClick}
				>
					<Share2Icon />
					<span>Share</span>
				</button>
			</center>
		</section>
		<hr class="my-8" />
		<section class="p-1">
			<h3 class="text-3xl font-semibold">Restore Backup</h3>
			<div class="flex flex-row items-center space-x-4">
				<p>To restore:</p>
				<input
					id="backupFile"
					type="file"
					name="files"
					accept=".json"
					class="file-input file-input-secondary rounded"
					onchange={(e) => {
						const target = e.target as HTMLInputElement;
						void onFileChosen(target.files?.[0]);
						target.value = '';
					}}
				/>
				<label class="label" for="backupFile">
					<span>Click to choose the backup file</span>
				</label>
			</div>
			<p class="mt-2 text-sm opacity-70">
				Settings replace what is on this device. Both kinds of transactions are merged with it, and
				trusted devices are added.
			</p>

			{#if restoreInfo}
				<div
					class="card border-base-300 mt-3 border p-3"
					role="group"
					aria-label="Restore selection"
				>
					<p class="pb-2 opacity-60">
						Restore from {restoreName} (backup format {restoreInfo.version})
					</p>
					<ul class="space-y-1">
						{#each restoreInfo.sections as section (section)}
							{@const emptySettings = section === 'settings' && restoreInfo.counts.settings === 0}
							<li>
								<label class="flex cursor-pointer items-start gap-2">
									<input
										type="checkbox"
										class="checkbox checkbox-sm mt-1"
										value={section}
										disabled={busy || emptySettings}
										bind:group={restoreSelected}
									/>
									<span>
										{SECTION_LABELS[section].title}
										{#if emptySettings}
											<span class="block text-xs opacity-60">the list in this file is empty</span>
										{:else if section === 'settings'}
											<span class="block text-xs opacity-60">replaces what is on this device</span>
										{:else if section === 'peers'}
											<span class="block text-xs opacity-60">
												{restoreInfo.counts.peers} device(s), added; only restore a file you trust
											</span>
										{:else if section === 'scx' || section === 'workingSet'}
											<span class="block text-xs opacity-60">
												{preview ? describePreview(preview[section]) : 'comparing…'}
											</span>
										{/if}
										{#if section === 'scx' && restoreInfo.scxIsList}
											<span class="text-warning block text-xs">
												This older file has no history. After a sync, deleted entries can return and
												old versions can replace newer edits, also on other devices. If sync has
												your current data, leave this out.
											</span>
										{/if}
									</span>
								</label>
							</li>
						{/each}
					</ul>
					{#if restoreInfo.hasSecrets}
						<div class="mt-3">
							<label class="label" for="restore-passphrase">
								<span class="label-text">Passphrase for the credentials in this file</span>
							</label>
							<input
								id="restore-passphrase"
								type="password"
								autocomplete="off"
								class="input input-bordered w-full font-mono"
								bind:value={restorePassphrase}
							/>
							<p class="mt-1 text-xs opacity-60">
								Leave it empty to restore without the credentials.
							</p>
						</div>
					{/if}
					{#if restoreInfo.version < 2}
						<p class="mt-3 text-xs opacity-60">
							This is an old backup file: it holds only settings and scheduled transactions.
						</p>
					{/if}

					{#if destroyable.length > 0}
						<div class="border-error rounded-box mt-3 space-y-2 border-2 p-3">
							<p class="flex items-start gap-2 text-sm">
								<TriangleAlert size={18} class="text-error shrink-0" />
								<span>
									Merging does not undo later changes. To return to the backup's state, destroy
									first, then restore.
								</span>
							</p>
							<div class="flex flex-wrap gap-2">
								{#each destroyable as section (section)}
									<button
										type="button"
										class="btn btn-error btn-outline btn-sm"
										disabled={busy}
										onclick={() => (destroyTarget = DESTROY_TARGETS[section])}
									>
										<TriangleAlert size={16} />
										Destroy local {STORE_LABELS[section].toLowerCase()}…
									</button>
								{/each}
							</div>
						</div>
					{/if}

					<div class="mt-4 flex justify-end gap-4">
						<button type="button" class="btn btn-ghost" disabled={busy} onclick={closeRestore}>
							Cancel
						</button>
						<button
							type="button"
							class="btn btn-primary text-primary-content"
							disabled={busy || !preview || restoreSelected.length === 0}
							onclick={onRestoreClick}
						>
							Restore
						</button>
					</div>
				</div>
			{/if}

			{#if restoreMessages.length > 0}
				<div class="alert alert-info mt-3 flex flex-col items-start text-sm">
					{#each restoreMessages as message}
						<p>{message}</p>
					{/each}
				</div>
			{/if}

			<div class="mt-3">
				<p>After restoring a backup, you should</p>
				<ul class="list-disc pl-6">
					<li>
						load the Asset Allocation definition file (it is then stored in OPFS, which is not
						backed up)
					</li>
					<li>perform a Cashier Sync to populate the latest financial data</li>
				</ul>
			</div>
		</section>
	</div>
</main>

{#if destroyTarget}
	<DestroyStoreDialog target={destroyTarget} onclose={onDestroyClosed} />
{/if}
