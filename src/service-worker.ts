/// <reference lib="webworker" />
import { assets, immutable } from '$app/manifest';
import {
	cleanupOutdatedCaches,
	createHandlerBoundToURL,
	precacheAndRoute
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

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

// Prompt-style update: the new worker waits until the page asks it to take over.
self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
