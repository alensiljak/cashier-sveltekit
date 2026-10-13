import { sveltekit } from '@sveltejs/kit/vite';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// SvelteKit's default version is Date.now(). Any per-build value (timestamp, commit SHA) is
// inlined into a shared chunk and into the `__sveltekit_<hash>` global of every prerendered
// page, so each build renames nearly every file and the service worker re-downloads all of
// them. The app never reads the version and updates are detected via service-worker.js, which
// derives its own precache revision from the hashed build file list, so keep it constant.
const APP_VERSION = 'static';

// The real build time (ISO 8601, UTC; the about page renders it in the viewer's timezone).
// It is referenced only by the service worker, which reports it to the page, so the page shows
// the version of the worker that is actually running. Putting it in the app bundle would rename
// that chunk, app.*.js and every prerendered page on each build. Fetching it from a file at
// runtime would return the newest deployed build instead of the installed one.
const BUILD_TIMESTAMP = new Date().toISOString();

// Content hash of every file in static/, keyed by its URL path. The service worker uses these as
// precache revisions, so a static file is re-downloaded only when its own content changes.
function staticRevisions(): Record<string, string> {
	const root = path.resolve(import.meta.dirname, 'static');
	const result: Record<string, string> = {};
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else {
				const url = '/' + path.relative(root, full).split(path.sep).join('/');
				result[url] = crypto
					.createHash('sha1')
					.update(fs.readFileSync(full))
					.digest('hex')
					.slice(0, 12);
			}
		}
	};
	if (fs.existsSync(root)) walk(root);
	return result;
}

const config: UserConfig = defineConfig({
	define: {
		__STATIC_REVISIONS__: JSON.stringify(staticRevisions()),
		__BUILD_TIMESTAMP__: JSON.stringify(BUILD_TIMESTAMP)
	},
	server: {
		host: '0.0.0.0',
		// Ensure WASM files are served correctly in dev mode
		fs: {
			allow: ['..', path.resolve(import.meta.dirname, '..', '..', '..', 'node_modules')]
		}
		// Needed when running in a container and using source files on the host.
		// Or, use CHOKIDAR_USEPOLLING env var in devcontainer.json.
		// watch: {
		// 	usePolling: true,
		// 	interval: 500 // ms
		// }
	},
	build: {
		sourcemap: false
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: adapter({ fallback: '200.html' }),
			version: { name: APP_VERSION },
			// registered manually in #lib/services/pwaUpdate (prompt-style updates)
			serviceWorker: { register: false }
		})
	]
});

// Vitest configuration is separate - see vitest.config.ts or package.json

export default config;
