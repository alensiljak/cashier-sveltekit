/**
 * System notification helpers for the Cashier PWA.
 *
 * Permission must be requested from a user-gesture handler (e.g. a button click).
 * Actual notification display can happen from any async context.
 */

const BACKUP_TAG = 'cashier-webdav-backup';
const BACKUP_DISMISS_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Request notification permission from the user.
 * MUST be called inside a user-gesture handler (click, etc.).
 * Returns true if permission is now granted.
 */
export async function requestNotificationPermission(): Promise<boolean> {
	if (typeof window === 'undefined' || !('Notification' in window)) return false;
	if (Notification.permission === 'granted') return true;
	if (Notification.permission === 'denied') return false;

	const result = await Notification.requestPermission();
	return result === 'granted';
}

/**
 * Show a system notification confirming the WebDAV backup, then auto-dismiss
 * it after 2 minutes. Silently no-ops if permission is not granted.
 */
export async function showBackupNotification(): Promise<void> {
	if (typeof window === 'undefined' || !('Notification' in window)) return;
	if (Notification.permission !== 'granted') return;

	const icon = '/icon-192.png';
	const title = 'Journal backed up';
	const body = 'cashier.bean has been uploaded to your WebDAV server.';

	try {
		// Prefer service-worker notifications (work when the tab is in background/PWA).
		if ('serviceWorker' in navigator) {
			const reg = await navigator.serviceWorker.ready;
			await reg.showNotification(title, { body, icon, tag: BACKUP_TAG });

			setTimeout(async () => {
				try {
					const notes = await reg.getNotifications({ tag: BACKUP_TAG });
					notes.forEach((n) => n.close());
				} catch {
					// ignore — notification may have already been dismissed
				}
			}, BACKUP_DISMISS_MS);
		} else {
			// Fallback: main-thread Notification (desktop browsers without SW).
			const n = new Notification(title, { body, icon, tag: BACKUP_TAG });
			setTimeout(() => n.close(), BACKUP_DISMISS_MS);
		}
	} catch (err) {
		console.warn('[webdav-auto-backup] Could not show system notification:', err);
	}
}
