/**
 * Scheduled-transaction reminders.
 *
 * A PWA cannot reliably fire a notification at an exact time while closed
 * (Notification Triggers were dropped from Chromium; Periodic Background Sync
 * is only best-effort, ~12h granularity). So the reminder fires while the app is
 * open (or resumed) once the configured time of day has passed, at most once a day.
 */
import { addDays, formatDate } from '#lib/utils/dates';
import { listScxDueOn } from '#lib/services/scxService';
import { DeviceSettingKeys, deviceSettings } from '#lib/settings';
import { showDueTransactionsNotification } from '#lib/utils/webNotification';

export const NOTIFICATION_TIME_DEFAULT = '08:00';

/** The given day at the 'HH:mm' wall-clock time. */
function atTime(day: Date, time: string): Date {
	const [hours, minutes] = time.split(':').map(Number);
	return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes);
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows the reminder if it is enabled, past the set time, and not yet shown today. */
export async function checkDueNotification(): Promise<void> {
	if (!(await deviceSettings.get<boolean>(DeviceSettingKeys.notificationsEnabled))) return;

	const time =
		(await deviceSettings.get<string>(DeviceSettingKeys.notificationTime)) ??
		NOTIFICATION_TIME_DEFAULT;
	const now = new Date();
	const today = formatDate(now);
	if (now < atTime(now, time)) return;
	if ((await deviceSettings.get<string>(DeviceSettingKeys.notificationLastShown)) === today) return;

	const due = await listScxDueOn(today);
	// Mark as handled even when nothing is due, so we don't query again all day.
	await deviceSettings.set(DeviceSettingKeys.notificationLastShown, today);
	if (due.length === 0) return;

	await showDueTransactionsNotification(
		due.map((s) => s.transaction?.payee || s.remarks || '(no payee)')
	);
}

/** (Re)arms the in-app timer for the configured time. Call after startup and after settings change. */
export async function scheduleNotificationCheck(): Promise<void> {
	clearTimeout(timer);
	if (!(await deviceSettings.get<boolean>(DeviceSettingKeys.notificationsEnabled))) return;

	await checkDueNotification();

	const time =
		(await deviceSettings.get<string>(DeviceSettingKeys.notificationTime)) ??
		NOTIFICATION_TIME_DEFAULT;
	const now = new Date();
	let target = atTime(now, time);
	if (target <= now) target = addDays(target, 1);
	timer = setTimeout(scheduleNotificationCheck, target.getTime() - now.getTime() + 1000);
}

/** Starts the reminders and re-checks when the app returns to the foreground. */
export function initNotifications(): void {
	scheduleNotificationCheck();
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') scheduleNotificationCheck();
	});
}
