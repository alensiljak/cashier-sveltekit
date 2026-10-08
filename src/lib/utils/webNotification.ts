/**
 * System notification helpers for the Cashier PWA.
 *
 * Permission must be requested from a user-gesture handler (e.g. a button click).
 * Actual notification display can happen from any async context.
 */

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
 * Show a system notification listing the scheduled transactions due today.
 * Silently no-ops if permission is not granted.
 */
export async function showDueTransactionsNotification(lines: string[]): Promise<void> {
	if (typeof window === 'undefined' || !('Notification' in window)) return;
	if (Notification.permission !== 'granted') return;

	const title =
		lines.length === 1 ? '1 transaction due today' : `${lines.length} transactions due today`;
	const options = { body: lines.join('\n'), icon: '/icon-192.png', tag: 'cashier-scheduled-due' };

	try {
		if ('serviceWorker' in navigator) {
			const reg = await navigator.serviceWorker.ready;
			await reg.showNotification(title, options);
		} else {
			new Notification(title, options);
		}
	} catch (err) {
		console.warn('[notifications] Could not show system notification:', err);
	}
}
