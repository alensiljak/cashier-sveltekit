<script lang="ts">
	import { onMount } from 'svelte';
	import Fab from '$lib/components/FAB.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { CheckIcon } from '@lucide/svelte';
	import Notifier from '$lib/utils/notifier';
	import {
		emptyS3Config,
		isS3Configured,
		loadS3Config,
		saveS3Config,
		type S3Config
	} from '$lib/services/s3Config';
	import { testConnection, type S3TestStep } from '$lib/services/s3Client';
	import { deviceSettings, DeviceSettingKeys } from '$lib/settings';
	import { lastBackupTime } from '$lib/services/webdavAutoBackupService';
	import { requestNotificationPermission } from '$lib/utils/webNotification';
	import { CloudIcon } from '@lucide/svelte';

	let cfg = $state<S3Config>(emptyS3Config());
	let testing = $state(false);
	let testSteps = $state<S3TestStep[]>([]);

	async function test() {
		if (!isS3Configured(cfg)) {
			Notifier.error('Endpoint, bucket, access key ID and secret access key are required');
			return;
		}
		testing = true;
		testSteps = [];
		try {
			testSteps = await testConnection({ ...cfg, prefix: cfg.prefix.replace(/^\/+|\/+$/g, '') });
		} finally {
			testing = false;
		}
	}

	let autoBackupEnabled = $state(false);

	onMount(async () => {
		autoBackupEnabled = (await deviceSettings.get<boolean>(DeviceSettingKeys.s3AutoBackup)) ?? false;
		const saved = await loadS3Config();
		if (saved) cfg = saved;
	});

	async function toggleAutoBackup() {
		autoBackupEnabled = !autoBackupEnabled;
		await deviceSettings.set(DeviceSettingKeys.s3AutoBackup, autoBackupEnabled);
		if (autoBackupEnabled) await requestNotificationPermission();
	}

	async function save() {
		if (!isS3Configured(cfg)) {
			Notifier.error('Endpoint, bucket, access key ID and secret access key are required');
			return;
		}
		await saveS3Config({ ...cfg, prefix: cfg.prefix.replace(/^\/+|\/+$/g, '') });
		Notifier.success('S3 configuration saved');
		history.back();
	}
</script>

<main class="flex h-screen flex-col">
	<Toolbar title="S3 Configuration" />
	<section class="flex-1 space-y-4 overflow-y-auto touch-pan-y p-4">
		<div class="mx-auto max-w-2xl space-y-4">
			<div class="card bg-base-200 shadow-xl">
				<form
					class="card-body p-4"
					onsubmit={(e) => {
						e.preventDefault();
						save();
					}}
				>
					<h2 class="card-title text-lg">Bucket</h2>

					<div class="form-control md:flex-row md:items-center md:gap-3">
						<label class="label md:w-40 md:flex-shrink-0" for="s3-endpoint">
							<span class="label-text">Endpoint</span>
						</label>
						<input
							id="s3-endpoint"
							type="url"
							bind:value={cfg.endpoint}
							placeholder="https://&lt;account&gt;.r2.cloudflarestorage.com"
							class="input input-bordered font-mono text-sm md:flex-1"
						/>
					</div>

					<div class="form-control mt-2 md:mt-0 md:flex-row md:items-center md:gap-3">
						<label class="label md:w-40 md:flex-shrink-0" for="s3-region">
							<span class="label-text">Region</span>
						</label>
						<input
							id="s3-region"
							type="text"
							bind:value={cfg.region}
							placeholder="auto"
							class="input input-bordered md:flex-1"
						/>
					</div>

					<div class="form-control mt-2 md:mt-0 md:flex-row md:items-center md:gap-3">
						<label class="label md:w-40 md:flex-shrink-0" for="s3-bucket">
							<span class="label-text">Bucket</span>
						</label>
						<input
							id="s3-bucket"
							type="text"
							bind:value={cfg.bucket}
							class="input input-bordered md:flex-1"
						/>
					</div>

					<div class="form-control mt-2 md:mt-0 md:flex-row md:items-center md:gap-3">
						<label class="label md:w-40 md:flex-shrink-0" for="s3-prefix">
							<span class="label-text">Folder (optional)</span>
						</label>
						<input
							id="s3-prefix"
							type="text"
							bind:value={cfg.prefix}
							placeholder="cashier"
							class="input input-bordered md:flex-1"
						/>
					</div>

					<h2 class="card-title mt-4 text-lg">Credentials</h2>

					<div class="form-control md:flex-row md:items-center md:gap-3">
						<label class="label md:w-40 md:flex-shrink-0" for="s3-key-id">
							<span class="label-text">Access key ID</span>
						</label>
						<input
							id="s3-key-id"
							type="text"
							autocomplete="off"
							bind:value={cfg.accessKeyId}
							class="input input-bordered font-mono text-sm md:flex-1"
						/>
					</div>

					<div class="form-control mt-2 md:mt-0 md:flex-row md:items-center md:gap-3">
						<label class="label md:w-40 md:flex-shrink-0" for="s3-secret">
							<span class="label-text">Secret access key</span>
						</label>
						<input
							id="s3-secret"
							type="password"
							autocomplete="off"
							bind:value={cfg.secretAccessKey}
							class="input input-bordered font-mono text-sm md:flex-1"
						/>
					</div>

					<h2 class="card-title mt-4 text-lg">Encryption</h2>

					<div class="form-control md:flex-row md:items-center md:gap-3">
						<label class="label md:w-40 md:flex-shrink-0" for="s3-passphrase">
							<span class="label-text">Passphrase</span>
						</label>
						<input
							id="s3-passphrase"
							type="password"
							autocomplete="off"
							bind:value={cfg.passphrase}
							class="input input-bordered md:flex-1"
						/>
					</div>

					{#if testSteps.length}
							<ul class="mt-2 space-y-1 text-sm">
								{#each testSteps as step (step.name)}
									<li class={step.ok ? 'text-success' : 'text-error'}>
										{step.ok ? '✓' : '✗'}
										{step.name}: {step.message}
									</li>
								{/each}
							</ul>
						{/if}

						<div class="card-actions mt-4 justify-center">
						<button type="button" class="btn btn-outline" onclick={test} disabled={testing}>
								{#if testing}<span class="loading loading-spinner loading-sm"></span>{/if}
								Test connection
							</button>					</div>
				</form>
			</div>

			<!-- Auto-backup -->
			<div class="card bg-base-200 shadow-xl">
				<div class="card-body p-4">
					<label class="flex items-center gap-3 cursor-pointer">
						<span class="flex-1">
							<span class="font-medium">Auto-backup local transactions</span>
							<span class="block text-xs text-base-content/50">
								Upload to the S3 bucket automatically after each change
							</span>
						</span>
						<input
							type="checkbox"
							class="toggle toggle-primary bg-transparent bg-none"
							checked={autoBackupEnabled}
							disabled={!isS3Configured(cfg) || !cfg.passphrase}
							onclick={toggleAutoBackup}
						/>
					</label>
					{#if $lastBackupTime}
						<p class="text-xs text-base-content/50 flex items-center gap-1">
							<CloudIcon size={12} />
							Last auto-backup: {$lastBackupTime.toLocaleString()}
						</p>
					{/if}
				</div>
			</div>

			<div class="card bg-base-200 shadow-xl">
				<div class="card-body p-4">
					<h2 class="card-title text-lg">Instructions</h2>
					<ul class="list-disc list-inside space-y-1 text-sm opacity-80">
						<li>
							Cloudflare R2 endpoint: <code class="text-xs"
								>https://&lt;account-id&gt;.r2.cloudflarestorage.com</code
							>, region <code class="text-xs">auto</code>.
						</li>
						<li>
							Create an API token limited to this one bucket. The credentials stay on this device
							only and are not part of settings backups.
						</li>
						<li>
							The bucket needs a CORS policy, otherwise the browser will block requests. The policy should
							allow this app's origin, and headers.
						</li>
						<li>
							Everything uploaded is encrypted on this device with the passphrase. Use the same
							passphrase on every device. If it is lost, the data in the bucket cannot be recovered.
						</li>
					</ul>
				</div>
			</div>
		</div>
	</section>
	<Fab Icon={CheckIcon} onclick={save} />
</main>
