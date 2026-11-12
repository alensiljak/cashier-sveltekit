<script lang="ts">
	import Toolbar from '#lib/components/Toolbar.svelte';
	import RestoredDeviceNotice from '#lib/components/RestoredDeviceNotice.svelte';
	import HelpButton from '#lib/help/HelpButton.svelte';
	import * as BackupService from '#lib/services/backupService';
	import { MIN_BACKUP_PASSPHRASE_LENGTH, checkPassphrase } from '#lib/services/backupSecrets';
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
	let isRestoreConfirmationOpen = $state(false);
	let notice = $state<{ refresh: () => Promise<void> }>();
	let restoreMessages = $state<string[]>([]);

	Notifier.init();

	onMount(() => {
		_filename = BackupService.getBackupFilename();
	});

	function closeModal() {
		isRestoreConfirmationOpen = false;
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
		try {
			const content = await file.text();
			restoreInfo = BackupService.inspectBackup(content);
			restoreContent = content;
			restoreName = file.name;
			restoreSelected = [...restoreInfo.sections];
			restorePassphrase = '';
			isRestoreConfirmationOpen = true;
		} catch (error) {
			Notifier.error(
				`Cannot restore, existing data was kept: ${error instanceof Error ? error.message : error}`
			);
		}
	}

	async function onRestoreConfirmed() {
		if (!restoreContent) return;
		closeModal();
		busy = true;
		try {
			const result = await BackupService.restoreBackup(restoreContent, {
				sections: restoreSelected,
				secretsPassphrase: restorePassphrase || undefined
			});
			restoreMessages = describe(result);
			Notifier.success('Backup restored');
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

	function describe(result: BackupService.RestoreResult): string[] {
		const out: string[] = [];
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
				Settings and scheduled transactions replace what is on this device. The transactions and the
				trusted devices are added to it.
			</p>

			{#if restoreMessages.length > 0}
				<div class="alert alert-info mt-3 flex-col items-start text-sm">
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

<!-- "Restore" dialog -->
<input
	type="checkbox"
	id="restore-confirmation-modal"
	class="modal-toggle"
	bind:checked={isRestoreConfirmationOpen}
/>
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Confirm Restore</h2>
		</header>
		<article>
			<p class="py-2 opacity-60">
				Restore from {restoreName}
				{#if restoreInfo}(backup format {restoreInfo.version}){/if}?
			</p>
			{#if restoreInfo}
				<ul class="space-y-1">
					{#each restoreInfo.sections as section (section)}
						<li>
							<label class="flex cursor-pointer items-start gap-2">
								<input
									type="checkbox"
									class="checkbox checkbox-sm mt-1"
									value={section}
									bind:group={restoreSelected}
								/>
								<span>
									{SECTION_LABELS[section].title}
									{#if section === 'settings' || section === 'scx'}
										<span class="block text-xs opacity-60">replaces what is on this device</span>
									{:else if section === 'peers'}
										<span class="block text-xs opacity-60">
											{restoreInfo.counts.peers} device(s), added; only restore a file you trust
										</span>
									{:else if section === 'workingSet'}
										<span class="block text-xs opacity-60">added to this device's transactions</span
										>
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
			{/if}
		</article>
		<footer class="mt-4 flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary text-primary-content"
				disabled={restoreSelected.length === 0}
				onclick={onRestoreConfirmed}>Restore</button
			>
		</footer>
	</div>
</dialog>
