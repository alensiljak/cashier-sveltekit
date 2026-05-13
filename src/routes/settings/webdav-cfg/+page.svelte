<script lang="ts">
	import { onMount } from 'svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import Notifier from '$lib/utils/notifier';
	import { settings, SettingKeys } from '$lib/settings';
	import { WebDavClient, type WebDavEntry } from '$lib/utils/webdav';
	import { ChevronRight, ChevronUp } from '@lucide/svelte';

	let url = '';
	let username = '';
	let password = '';
	let uploadFilename = 'cashier.bean';
	let downloadFilename = 'cashier.bean';
	let content = '';
	let readContent = '';
	let isUploading = false;
	let isDownloading = false;
	let corsError = false;
	let uploadOpen = false;
	let downloadOpen = false;
	let isTesting = false;
	let remoteFiles: WebDavEntry[] = [];
	let testDone = false;

	onMount(async () => {
		const saved = await settings.get<{ url: string; username: string; password: string }>(
			SettingKeys.webdavSettings
		);
		if (saved) {
			url = saved.url ?? '';
			username = saved.username ?? '';
			password = saved.password ?? '';
		}
	});

	async function testSettings(): Promise<void> {
		if (!url) {
			Notifier.error('WebDAV URL is required');
			return;
		}
		isTesting = true;
		corsError = false;
		remoteFiles = [];
		testDone = false;
		try {
			remoteFiles = await new WebDavClient(url, username, password).list();
			testDone = true;
			Notifier.success(`Found ${remoteFiles.length} item(s)`);
		} catch (err) {
			const msg = (err as Error).message;
			if (msg.toLowerCase().includes('cors') || msg.toLowerCase().includes('network')) {
				corsError = true;
			}
			Notifier.error('Test failed: ' + msg);
		} finally {
			isTesting = false;
		}
	}

	async function saveSettings() {
		await settings.set(SettingKeys.webdavSettings, { url, username, password });
	}

	async function upload(): Promise<void> {
		if (!url || !uploadFilename || !content) {
			Notifier.error('URL, filename, and content are required');
			return;
		}
		isUploading = true;
		corsError = false;
		try {
			const res = await new WebDavClient(url, username, password).put(uploadFilename, content);
			if (res.ok) {
				Notifier.success(`Uploaded: ${res.status} ${res.statusText}`);
			} else {
				Notifier.error(`Server error: ${res.status} ${res.statusText}`);
			}
		} catch (err) {
			const msg = (err as Error).message;
			if (msg.toLowerCase().includes('cors') || msg.toLowerCase().includes('network')) {
				corsError = true;
			}
			Notifier.error('Request failed: ' + msg);
		} finally {
			isUploading = false;
		}
	}

	async function download(): Promise<void> {
		if (!url || !downloadFilename) {
			Notifier.error('URL and filename are required');
			return;
		}
		isDownloading = true;
		corsError = false;
		try {
			const res = await new WebDavClient(url, username, password).get(downloadFilename);
			if (res.ok) {
				readContent = await res.text();
				Notifier.success('File downloaded');
			} else {
				Notifier.error(`Server error: ${res.status} ${res.statusText}`);
			}
		} catch (err) {
			const msg = (err as Error).message;
			if (msg.toLowerCase().includes('cors') || msg.toLowerCase().includes('network')) {
				corsError = true;
			}
			Notifier.error('Request failed: ' + msg);
		} finally {
			isDownloading = false;
		}
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="WebDAV Sync Demo" />
	<section class="flex-1 space-y-4 overflow-y-auto touch-pan-y p-4">

		<!-- Config Card -->
		<div class="card bg-base-200 shadow-xl">
			<div class="card-body p-4">
				<h2 class="card-title text-lg">Configuration</h2>

				<div class="form-control md:flex-row md:items-center md:gap-3">
					<label class="label md:w-40 md:flex-shrink-0" for="dav-url">
						<span class="label-text">WebDAV folder URL</span>
					</label>
					<input
						id="dav-url"
						type="url"
						bind:value={url}
						onchange={saveSettings}
						placeholder="https://nextcloud.example.com/remote.php/dav/files/user/cashier/"
						class="input input-bordered font-mono text-sm md:flex-1"
					/>
				</div>

				<div class="form-control mt-2 md:flex-row md:items-center md:gap-3 md:mt-0">
					<label class="label md:w-40 md:flex-shrink-0" for="dav-user">
						<span class="label-text">Username</span>
					</label>
					<input
						id="dav-user"
						type="text"
						bind:value={username}
						onchange={saveSettings}
						class="input input-bordered md:flex-1"
					/>
				</div>

				<div class="form-control mt-2 md:flex-row md:items-center md:gap-3 md:mt-0">
					<label class="label md:w-40 md:flex-shrink-0" for="dav-pass">
						<span class="label-text">Password / App token</span>
					</label>
					<input
						id="dav-pass"
						type="password"
						bind:value={password}
						onchange={saveSettings}
						class="input input-bordered md:flex-1"
					/>
				</div>
			</div>
		</div>

		<!-- Test Settings -->
		<div class="card bg-base-200 shadow-xl">
			<div class="card-body p-4">
				<h2 class="card-title text-lg">Test Settings</h2>
				<p class="text-sm opacity-70">List the files in the configured directory to verify connectivity and credentials.</p>
				<button class="btn btn-secondary mt-2 self-start" onclick={testSettings} disabled={isTesting}>
					{#if isTesting}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Test Settings
				</button>
				{#if testDone}
					{#if remoteFiles.length === 0}
						<p class="mt-3 text-sm opacity-70">Directory is empty.</p>
					{:else}
						<div class="overflow-x-auto mt-3">
							<table class="table table-sm">
								<thead>
									<tr>
										<th>Name</th>
										<th class="text-right">Size</th>
										<th>Last Modified</th>
									</tr>
								</thead>
								<tbody>
									{#each remoteFiles as f}
										<tr>
											<td class="font-mono text-xs">{f.isDirectory ? '📁 ' : ''}{f.name}</td>
											<td class="text-right text-xs tabular-nums">{f.size != null ? f.size.toLocaleString() + ' B' : '—'}</td>
											<td class="text-xs">{f.lastModified ? f.lastModified.toLocaleString() : '—'}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				{/if}
			</div>
		</div>

		<!-- CORS warning -->
		{#if corsError}
			<div class="alert alert-warning">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
					<path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
				</svg>
				<div>
					<p class="font-semibold">CORS error detected</p>
					<p class="text-sm">The server blocked the request from a browser origin. In NextCloud you may need to add the app's origin to <code>config.php</code> under <code>cors.allowed-origins</code>, or use an app password with a CORS-enabled proxy.</p>
				</div>
			</div>
		{/if}

		<!-- Upload Card -->
		<details class="card bg-base-200 shadow-xl" bind:open={uploadOpen}>
			<summary class="card-body p-4 cursor-pointer flex flex-row justify-between items-center">
				<h2 class="card-title text-lg">Upload (PUT)</h2>
				{#if uploadOpen}<ChevronUp size={20} />{:else}<ChevronRight size={20} />{/if}
			</summary>
			<div class="card-body p-4 pt-0">
				<div class="form-control md:flex-row md:items-center md:gap-3">
					<label class="label md:w-32 md:flex-shrink-0" for="upload-filename">
						<span class="label-text">File name</span>
					</label>
					<input
						id="upload-filename"
						type="text"
						bind:value={uploadFilename}
						class="input input-bordered font-mono md:flex-1"
					/>
				</div>

				<p class="text-sm opacity-70 mt-2">Paste or type the content to send to the remote file.</p>

				<div class="form-control mt-2">
					<label class="label" for="upload-content">
						<span class="label-text">Content</span>
					</label>
					<textarea
						id="upload-content"
						bind:value={content}
						placeholder="2024-01-01 * &quot;Grocery&quot; ..."
						class="textarea textarea-bordered h-40 font-mono text-xs"
					></textarea>
				</div>

				<button
					class="btn btn-primary mt-3"
					onclick={upload}
					disabled={isUploading}
				>
					{#if isUploading}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Upload file
				</button>
			</div>
		</details>

		<!-- Download Card -->
		<details class="card bg-base-200 shadow-xl" bind:open={downloadOpen}>
			<summary class="card-body p-4 cursor-pointer flex flex-row justify-between items-center">
				<h2 class="card-title text-lg">Download (GET)</h2>
				{#if downloadOpen}<ChevronUp size={20} />{:else}<ChevronRight size={20} />{/if}
			</summary>
			<div class="card-body p-4 pt-0">
				<div class="form-control md:flex-row md:items-center md:gap-3">
					<label class="label md:w-32 md:flex-shrink-0" for="download-filename">
						<span class="label-text">File name</span>
					</label>
					<input
						id="download-filename"
						type="text"
						bind:value={downloadFilename}
						class="input input-bordered font-mono md:flex-1"
					/>
				</div>

				<button
					class="btn btn-primary mt-3"
					onclick={download}
					disabled={isDownloading}
				>
					{#if isDownloading}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Read file from server
				</button>

				{#if readContent}
					<div class="form-control mt-3">
						<label class="label" for="read-content">
							<span class="label-text">File content</span>
						</label>
						<textarea
							id="read-content"
							bind:value={readContent}
							readonly
							class="textarea textarea-bordered h-52 font-mono text-xs"
						></textarea>
					</div>
				{/if}
			</div>
		</details>

		<!-- Notes -->
		<div class="card bg-base-200 shadow-xl">
			<div class="card-body p-4">
				<h2 class="card-title text-lg">Notes</h2>
				<ul class="list-disc list-inside space-y-1 text-sm opacity-80">
					<li>NextCloud WebDAV URL format: <code class="text-xs">https://&lt;host&gt;/remote.php/dav/files/&lt;user&gt;/&lt;path&gt;/</code></li>
					<li>Use an <strong>App Password</strong> (Settings → Security) rather than your account password.</li>
					<li>If you see a CORS error, the server must allow your app's origin. NextCloud does not enable CORS by default for browser requests.</li>
					<li>Workflow: phone uploads <code class="text-xs">cashier.bean</code> → PC polls / downloads → PC sorts into ledger files → PC deletes or clears the remote file.</li>
				</ul>
			</div>
		</div>

	</section>
</article>

<style>
	details > summary { list-style: none; }
	details > summary::-webkit-details-marker { display: none; }
</style>
