<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import Notifier from '$lib/utils/notifier';

	let url = '';
	let username = '';
	let password = '';
	let filename = 'cashier.bean';
	let content = '';
	let readContent = '';
	let isUploading = false;
	let isDownloading = false;
	let corsError = false;

	function buildAuthHeader(): string {
		return 'Basic ' + btoa(`${username}:${password}`);
	}

	function fileUrl(): string {
		const base = url.endsWith('/') ? url : url + '/';
		return base + filename;
	}

	async function upload(): Promise<void> {
		if (!url || !filename || !content) {
			Notifier.error('URL, filename, and content are required');
			return;
		}
		isUploading = true;
		corsError = false;
		try {
			const res = await fetch(fileUrl(), {
				method: 'PUT',
				headers: {
					Authorization: buildAuthHeader(),
					'Content-Type': 'text/plain; charset=utf-8'
				},
				body: content
			});
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
		if (!url || !filename) {
			Notifier.error('URL and filename are required');
			return;
		}
		isDownloading = true;
		corsError = false;
		try {
			const res = await fetch(fileUrl(), {
				method: 'GET',
				headers: {
					Authorization: buildAuthHeader()
				}
			});
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

				<div class="form-control">
					<label class="label" for="dav-url">
						<span class="label-text">WebDAV folder URL</span>
					</label>
					<input
						id="dav-url"
						type="url"
						bind:value={url}
						placeholder="https://nextcloud.example.com/remote.php/dav/files/user/cashier/"
						class="input input-bordered font-mono text-sm"
					/>
				</div>

				<div class="grid grid-cols-2 gap-2 mt-2">
					<div class="form-control">
						<label class="label" for="dav-user">
							<span class="label-text">Username</span>
						</label>
						<input
							id="dav-user"
							type="text"
							bind:value={username}
							class="input input-bordered"
						/>
					</div>
					<div class="form-control">
						<label class="label" for="dav-pass">
							<span class="label-text">Password / App token</span>
						</label>
						<input
							id="dav-pass"
							type="password"
							bind:value={password}
							class="input input-bordered"
						/>
					</div>
				</div>

				<div class="form-control mt-2">
					<label class="label" for="dav-filename">
						<span class="label-text">File name</span>
					</label>
					<input
						id="dav-filename"
						type="text"
						bind:value={filename}
						class="input input-bordered font-mono"
					/>
				</div>
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
		<div class="card bg-base-200 shadow-xl">
			<div class="card-body p-4">
				<h2 class="card-title text-lg">Upload (PUT)</h2>
				<p class="text-sm opacity-70">Paste or type the content to send to the remote file.</p>

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
					on:click={upload}
					disabled={isUploading}
				>
					{#if isUploading}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Upload file
				</button>
			</div>
		</div>

		<!-- Download Card -->
		<div class="card bg-base-200 shadow-xl">
			<div class="card-body p-4">
				<h2 class="card-title text-lg">Download (GET)</h2>

				<button
					class="btn btn-primary"
					on:click={download}
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
		</div>

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
