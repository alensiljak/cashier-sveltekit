/// <reference lib="webworker" />
import { assets, immutable } from '$app/manifest';
import {
	cleanupOutdatedCaches,
	createHandlerBoundToURL,
	precacheAndRoute
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
	MAX_SHARED_BYTES,
	SHARE_FIELD,
	SHARE_TARGET_PATH,
	storeSharedFiles
} from '#lib/services/sharedFiles';

declare const self: ServiceWorkerGlobalScope;

// Manifest paths are relative to the base path (none is configured), so make them root-absolute.
// SPA fallback page written by adapter-static (see vite.config.ts).
const SHELL = '/200.html';

const toUrl = ({ path }: { path: string }) => (path.startsWith('/') ? path : `/${path}`);
const build = immutable.map(toUrl);
const files = assets.map(toUrl);

// The kit version is pinned (see vite.config.ts), so derive a revision from the hashed build
// file list instead. It changes exactly when the shell (which embeds the hashed app.*.js)
// or any other precached file may have changed.
function hash(input: string): string {
	let h = 5381;
	for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}
const revision = hash(build.join('|'));

// Per-file content hashes of static/ (computed in vite.config.ts), so unchanged icons etc. are
// not re-downloaded when only the app bundle changes.
declare const __STATIC_REVISIONS__: Record<string, string>;

// Hashed build files are immutable (revision null); unhashed build output (e.g. build-info.json)
// and the shell change with the build; static files use their own content hash.
// Only the SPA fallback shell is precached: the app is ssr=false, so it serves every route.
precacheAndRoute([
	...build.map((url) => ({
		url,
		revision: url.includes('/immutable/') ? null : revision
	})),
	...files.map((url) => ({ url, revision: __STATIC_REVISIONS__[url] ?? revision })),
	{ url: SHELL, revision }
]);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL(SHELL)));

// Web Share Target: the OS POSTs shared files (multipart/form-data) to /share-target. There is no
// server, so stash the files and redirect (303 turns the POST into a GET) to the page that reads them.
registerRoute(
	// Same-origin only: without the origin check this also hijacks cross-origin POSTs to
	// any /share-target path made from pages this worker controls.
	({ url }) => url.origin === self.location.origin && url.pathname === SHARE_TARGET_PATH,
	async ({ request }) => {
		try {
			// Reject oversized shares. Content-Length (when present) is checked before buffering
			// the body; fetch/OS share POSTs may be chunked, so the parsed files' total is the
			// backstop that keeps them out of the cache.
			const length = Number(request.headers.get('content-length') ?? 0);
			if (length > MAX_SHARED_BYTES) throw new Error(`Shared payload too large: ${length} bytes`);
			const form = await request.formData();
			const files = form.getAll(SHARE_FIELD).filter((v): v is File => v instanceof File);
			const total = files.reduce((sum, f) => sum + f.size, 0);
			if (total > MAX_SHARED_BYTES) throw new Error(`Shared files too large: ${total} bytes`);
			await storeSharedFiles(files);
			return Response.redirect(SHARE_TARGET_PATH, 303);
		} catch (err) {
			console.error('Share target failed:', err);
			return Response.redirect(`${SHARE_TARGET_PATH}?error=1`, 303);
		}
	},
	'POST'
);

// Build time of this worker (see vite.config.ts), reported to the About page.
declare const __BUILD_TIMESTAMP__: string;

// Prompt-style update: the new worker waits until the page asks it to take over.
self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
	// Reply only to the page that asked, via the port it supplied.
	if (event.data?.type === 'GET_BUILD_TIMESTAMP') event.ports[0]?.postMessage(__BUILD_TIMESTAMP__);
});
