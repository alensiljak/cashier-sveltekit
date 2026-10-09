/**
 * Single point of service worker registration and update handling.
 * The layout initializes it; ReloadPrompt (toast) and the About page share its state.
 */
import { get, writable } from 'svelte/store';
import { dev } from '$app/env';
import type { Workbox } from 'workbox-window';

export type UpdateCheckResult = 'available' | 'latest' | 'unavailable' | 'error';

export const needRefresh = writable(false);
export const offlineReady = writable(false);

let registration: ServiceWorkerRegistration | undefined;
let workbox: Workbox | undefined;
let initPromise: Promise<void> | undefined;

export function initPwa(): Promise<void> {
	initPromise ??= (async () => {
		// The service worker is only built for production; there is nothing to register in dev.
		if (dev || !('serviceWorker' in navigator)) return;

		const { Workbox } = await import('workbox-window');
		const wb = new Workbox('/service-worker.js');
		workbox = wb;
		// A new worker finished installing while an older one is in control.
		wb.addEventListener('waiting', () => needRefresh.set(true));
		// First activation (not an update): the app is now cached for offline use.
		wb.addEventListener('activated', (event) => {
			if (!event.isUpdate) offlineReady.set(true);
		});
		try {
			registration = await wb.register();
		} catch (error) {
			console.log('SW registration error', error);
		}
	})();
	return initPromise;
}

/**
 * Activates the waiting service worker and reloads the page.
 *
 * The reload happens here, not on the `waiting` event, so it also covers updates found by
 * `checkForUpdate`.
 */
export async function updateApp(): Promise<void> {
	await initPwa();
	const reload = () => window.location.reload();
	navigator.serviceWorker?.addEventListener('controllerchange', reload, { once: true });
	// An uncontrolled page gets no controllerchange, so do not wait on it forever.
	setTimeout(reload, 3000);
	workbox?.messageSkipWaiting();
}

/**
 * Manually checks for a new version. If one is found, `needRefresh` is set,
 * which makes the reload prompt appear, the same as with the automatic check.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
	await initPwa();
	if (!registration) return 'unavailable';
	if (get(needRefresh)) return 'available';

	try {
		await registration.update();

		// update() resolves when the new worker starts installing, not when it is done.
		const installing = registration.installing;
		if (installing) {
			await new Promise<void>((resolve) => {
				const onChange = () => {
					if (installing.state === 'installing') return;
					installing.removeEventListener('statechange', onChange);
					resolve();
				};
				installing.addEventListener('statechange', onChange);
				onChange();
			});
			if (installing.state === 'redundant') return 'error';
		}

		if (registration.waiting) {
			needRefresh.set(true);
			return 'available';
		}
		return 'latest';
	} catch (error) {
		console.log('Update check failed', error);
		return 'error';
	}
}
