/**
 * Single point of service worker registration and update handling.
 * The layout initializes it; ReloadPrompt (toast) and the About page share its state.
 */
import { get, writable } from 'svelte/store';

export type UpdateCheckResult = 'available' | 'latest' | 'unavailable' | 'error';

export const needRefresh = writable(false);
export const offlineReady = writable(false);

let registration: ServiceWorkerRegistration | undefined;
let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | undefined;
let initPromise: Promise<void> | undefined;

export function initPwa(): Promise<void> {
	initPromise ??= (async () => {
		const { registerSW } = await import('virtual:pwa-register');
		applyUpdate = registerSW({
			immediate: true,
			onNeedRefresh: () => needRefresh.set(true),
			onOfflineReady: () => offlineReady.set(true),
			onRegisteredSW: (_url, r) => {
				registration = r;
			},
			onRegisterError: (error) => console.log('SW registration error', error)
		});
	})();
	return initPromise;
}

/** Activates the waiting service worker and reloads the page. */
export async function updateApp(): Promise<void> {
	await initPwa();
	await applyUpdate?.(true);
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
