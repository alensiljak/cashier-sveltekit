<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import Notifier from '$lib/utils/notifier';
	import {
		emptyS3Config,
		isS3Configured,
		loadS3Config,
		saveS3Config,
		type S3Config
	} from '$lib/services/s3Config';
	import { testConnection, type S3TestStep } from '$lib/services/s3Client';

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

	onMount(async () => {
		const saved = await loadS3Config();
		if (saved) cfg = saved;
	});

	async function save() {
		if (!isS3Configured(cfg)) {
			Notifier.error('Endpoint, bucket, access key ID and secret access key are required');
			return;
		}
		await saveS3Config({ ...cfg, prefix: cfg.prefix.replace(/^\/+|\/+$/g, '') });
		Notifier.success('S3 configuration saved');
		await goto('/backup/s3');
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

						<div class="card-actions mt-4 justify-end">
						<button type="button" class="btn btn-outline" onclick={test} disabled={testing}>
								{#if testing}<span class="loading loading-spinner loading-sm"></span>{/if}
								Test connection
							</button>
							<button type="submit" class="btn btn-primary">Save</button>
					</div>
				</form>
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
							The bucket needs a CORS policy that allows this app's origin, otherwise the browser
							will block requests.
						</li>
					</ul>
				</div>
			</div>
		</div>
	</section>
</main>
