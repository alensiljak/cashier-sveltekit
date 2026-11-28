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
	import FileUpIcon from '@lucide/svelte/icons/file-up';
	import Share2Icon from '@lucide/svelte/icons/share-2';
	import { onMount } from 'svelte';

	const SECTION_LABELS: Record<BackupService.BackupSection, { title: string; hint: string }> = {
		settings: { title: 'Shared settings', hint: 'the settings your devices share' },
		workingSet: { title: 'Working set', hint: 'the new transactions' },
		scx: { title: 'Scheduled transactions', hint: '' },
		device: { title: 'This device', hint: 'device settings, sync setup, trusted devices' },
		credentials: { title: 'Credentials', hint: 'passwords, keys and tokens, encrypted' }
	};
	/** What can be chosen for a backup besides the credentials, which have a switch of their own. */
	const PLAIN_SECTIONS = ['settings', 'workingSet', 'scx', 'device'] as const;

	const CREDENTIAL_NAMES: Record<string, string> = {
		webdav: 'WebDAV',
		s3: 'S3',
		webdavEncryption: 'WebDAV encryption',
		ice: 'TURN servers',
		proxy: 'HTTP proxy',
		mistral: 'Mistral',
		aware: 'Aware Super',
		scalable: 'Scalable Capital',
		enableBanking: 'Enable Banking',
		enableBankingSessions: 'Enable Banking sessions'
	};
	let _filename = $state<string>();

	// Backup options
	let selected = $state<(typeof PLAIN_SECTIONS)[number][]>([...PLAIN_SECTIONS]);
	let includeSecrets = $state(false);
	const nothingToBackUp = $derived(selected.length === 0 && !includeSecrets);
	let passphrase = $state('');
	let passphraseAgain = $state('');
	let showPassphrase = $state(false);
	let busy = $state(false);

	// Restore state
	let fileInput = $state<HTMLInputElement>();
	let restoreContent = $state<string>();
	let restoreName = $state('');
	let restoreCompressed = $state(false);
	let restoreInfo = $state<BackupService.BackupInfo>();
	let restoreSelected = $state<BackupService.BackupSection[]>([]);
	let restorePassphrase = $state('');
	let notice = $state<{ refresh: () => Promise<void> }>();
	let restoreMessages = $state<string[]>([]);
	/** What the restore would do to the transaction stores; undefined while that is worked out. */
	let preview = $state<BackupService.StoreOutcomes>();
	/** How many of the file's trusted devices a restore would add; worked out with `preview`. */
	let peersToAdd = $state<number>();
	/** The stores that have something to destroy. */
	let withHistory = $state<BackupService.StoreSection[]>([]);
	let destroyTarget = $state<'xacts' | 'scx' | null>(null);

	const STORE_SECTIONS: BackupService.StoreSection[] = ['workingSet', 'scx'];
	const STORE_LABELS: Record<BackupService.StoreSection, string> = {
		workingSet: 'Working set',
		scx: 'Scheduled transactions'
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

	/** Compares the chosen file with what is on this device now. */
	async function refreshPreview() {
		const content = restoreContent;
		preview = peersToAdd = undefined;
		if (!content) return;
		try {
			const [changes, peers, history] = await Promise.all([
				BackupService.previewRestore(content),
				BackupService.previewRestoredPeers(content),
				storesWithHistory()
			]);
			// Another file may have been chosen meanwhile.
			if (content !== restoreContent) return;
			preview = changes;
			peersToAdd = peers;
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
		const sections: BackupService.BackupOptions['sections'] = [...selected];
		if (!includeSecrets) return { sections };
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
		return { sections, secretsPassphrase: passphrase };
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
			const name = _filename as string;
			const compressed = new File([await BackupService.compressBackup(output)], name, {
				type: 'application/gzip'
			});
			// Not every browser can share a gzip file: plain JSON then.
			const file = navigator.canShare?.({ files: [compressed] })
				? compressed
				: new File([output], name.replace(/\.gz$/, ''), { type: 'application/json' });
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
			const { content, compressed } = await BackupService.decodeBackup(
				new Uint8Array(await file.arrayBuffer())
			);
			const info = BackupService.inspectBackup(content);
			restoreCompressed = compressed;
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
			// The card with the file name may close, so the report names the file too.
			restoreMessages =
				result.restored.length > 0
					? [`Restored from ${restoreName}.`, ...describe(result)]
					: describe(result);
			const nothingAdded = STORE_SECTIONS.filter((s) => result.stores[s]?.added === 0);
			if (result.restored.length === 0) {
				// Only the credentials were asked for, and the passphrase was missing or wrong.
				Notifier.error('Nothing was restored');
			} else if (nothingAdded.length === 0) {
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
			return `nothing changed, as this device has already seen everything in the backup. Records you deleted or edited since stay that way. ${toDestroy}`;
		}
		return `${added} added, ${changed} changed, ${deleted} deleted.`;
	}

	function describe(result: BackupService.RestoreResult): string[] {
		const out: string[] = [];
		for (const section of STORE_SECTIONS) {
			const outcome = result.stores[section];
			if (outcome) out.push(`${STORE_LABELS[section]}: ${describeOutcome(outcome)}`);
		}
		if (result.secrets === 'wrong-passphrase' || result.secrets === 'skipped') {
			const why =
				result.secrets === 'skipped' ? 'no passphrase was entered' : 'the passphrase did not fit';
			out.push(
				`The credentials were not restored: ${why}. Restore the file again with the right passphrase to get them.`
			);
		}
		if (result.unmatched) {
			out.push(
				'Some credentials of this older file were not restored, as they belong to connections this device does not have. Restore Shared settings and This device with them.'
			);
		}
		if (result.notificationsOff) {
			out.push('Notifications stay off until you allow them: turn them on in Settings.');
		}
		if (result.missing.length > 0) {
			out.push(
				'Still to enter (the pages mark them as required): ' +
					result.missing.map((id) => FIELD_NAMES[id] ?? id).join(', ') +
					'.'
			);
		}
		if (result.restored.includes('device') && restoreInfo?.counts.peers) {
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
				{#each PLAIN_SECTIONS as section (section)}
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
						{SECTION_LABELS.credentials.title}
						<span class="block text-xs opacity-60">{SECTION_LABELS.credentials.hint}</span>
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

			<div class="mx-2 mt-4">
				<label for="backup-filename">into</label>
				<input
					id="backup-filename"
					type="text"
					class="input input-bordered mt-1 w-full text-sm"
					bind:value={_filename}
					readonly
				/>
			</div>

			<center class="pt-4">
				<button
					type="button"
					class="btn btn-primary rounded"
					disabled={busy || nothingToBackUp}
					onclick={onBackupClick}
				>
					<FileDownIcon />
					<span>Backup</span>
				</button>
				<button
					type="button"
					class="btn btn-primary rounded"
					disabled={busy || nothingToBackUp}
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
			<!-- Hidden: the native control cannot show the choice, as it is cleared after each one,
			     so that choosing the same file again is noticed. -->
			<input
				id="backupFile"
				bind:this={fileInput}
				type="file"
				name="files"
				accept=".json,.gz,application/json,application/gzip"
				class="hidden"
				onchange={(e) => {
					const target = e.target as HTMLInputElement;
					void onFileChosen(target.files?.[0]);
					target.value = '';
				}}
			/>
			<p class="mt-2 text-sm opacity-70">
				Shared settings replace what is on this device. Both kinds of transactions are merged with
				it, and trusted devices are added.
			</p>

			{#if !restoreInfo}
				<center class="pt-4">
					<button
						type="button"
						class="btn btn-secondary rounded"
						disabled={busy}
						onclick={() => fileInput?.click()}
					>
						<FileUpIcon />
						<span>Choose backup file…</span>
					</button>
				</center>
			{:else}
				<div
					class="card border-base-300 mt-3 border p-3"
					role="group"
					aria-label="Restore selection"
				>
					<div class="border-base-300 mb-3 flex items-start gap-2 border-b pb-3">
						<div class="min-w-0 flex-1">
							<p class="font-semibold break-all">{restoreName}</p>
							<p class="text-xs opacity-60">
								Backup format {restoreInfo.version},
								{restoreCompressed ? 'compressed' : 'not compressed'},
								{restoreInfo.hasSecrets ? 'with encrypted credentials' : 'without credentials'}
							</p>
						</div>
						<button
							type="button"
							class="btn btn-sm shrink-0"
							disabled={busy}
							onclick={() => fileInput?.click()}
						>
							Change file
						</button>
					</div>
					<ul class="space-y-1">
						{#each BackupService.ALL_SECTIONS as section (section)}
							{@const present = restoreInfo.sections.includes(section)}
							{@const emptySettings = section === 'settings' && restoreInfo.counts.settings === 0}
							<li>
								<label class="flex cursor-pointer items-start gap-2" class:opacity-50={!present}>
									<input
										type="checkbox"
										class="checkbox checkbox-sm mt-1"
										value={section}
										disabled={busy || !present || emptySettings}
										bind:group={restoreSelected}
									/>
									<span>
										{SECTION_LABELS[section].title}
										{#if !present}
											<span class="block text-xs">not in this file</span>
										{:else if emptySettings}
											<span class="block text-xs opacity-60">the list in this file is empty</span>
										{:else if section === 'settings'}
											<span class="block text-xs opacity-60">replaces what is on this device</span>
										{:else if section === 'device' && restoreInfo.counts.peers > 0}
											<span class="block text-xs opacity-60">
												trusted devices: {restoreInfo.counts.peers} in this file, {peersToAdd ??
													'…'} to add. Only restore a file you trust
											</span>
										{:else if section === 'scx' || section === 'workingSet'}
											<span class="block text-xs opacity-60">
												{preview ? describePreview(preview[section]) : 'comparing…'}
											</span>
										{:else if section === 'credentials' && restoreInfo.credentials.length > 0}
											<span class="block text-xs opacity-60">
												{restoreInfo.credentials.map((id) => CREDENTIAL_NAMES[id] ?? id).join(', ')}
											</span>
										{/if}
										{#if section === 'scx' && present && restoreInfo.scxIsList}
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
					{#if restoreSelected.includes('credentials')}
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
									Records you deleted or edited after the backup was made stay that way. To get them
									back as they are in the backup, destroy first, then restore.
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
		</section>
	</div>
</main>

{#if destroyTarget}
	<DestroyStoreDialog target={destroyTarget} onclose={onDestroyClosed} />
{/if}
