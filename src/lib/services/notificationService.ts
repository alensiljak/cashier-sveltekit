/**
 * Scheduled-transaction reminders.
 *
 * A PWA cannot reliably fire a notification at an exact time while closed
 * (Notification Triggers were dropped from Chromium; Periodic Background Sync
 * is only best-effort, ~12h granularity). So the reminder fires while the app is
 * open (or resumed) once the configured time of day has passed, at most once a day.
 */
import moment from 'moment';
import db from '$lib/data/db';
import { DeviceSettingKeys, deviceSettings } from '$lib/settings';
import { showDueTransactionsNotification } from '$lib/utils/webNotification';

export const NOTIFICATION_TIME_DEFAULT = '08:00';
const DATE_FORMAT = 'YYYY-MM-DD';

let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows the reminder if it is enabled, past the set time, and not yet shown today. */
export async function checkDueNotification(): Promise<void> {
	if (!(await deviceSettings.get<boolean>(DeviceSettingKeys.notificationsEnabled))) return;

	const time =
		(await deviceSettings.get<string>(DeviceSettingKeys.notificationTime)) ??
		NOTIFICATION_TIME_DEFAULT;
	const now = moment();
	const today = now.format(DATE_FORMAT);
	if (now.isBefore(moment(`${today} ${time}`, `${DATE_FORMAT} HH:mm`))) return;
	if ((await deviceSettings.get<string>(DeviceSettingKeys.notificationLastShown)) === today) return;

	const due = await db.scheduled.where('nextDate').equals(today).toArray();
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
	let target = moment(`${moment().format(DATE_FORMAT)} ${time}`, `${DATE_FORMAT} HH:mm`);
	if (!target.isAfter(moment())) target = target.add(1, 'day');
	timer = setTimeout(scheduleNotificationCheck, target.diff(moment()) + 1000);
}

/** Starts the reminders and re-checks when the app returns to the foreground. */
export function initNotifications(): void {
	scheduleNotificationCheck();
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') scheduleNotificationCheck();
	});
}
