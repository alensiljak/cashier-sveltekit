/*
	Check and sync a channel through the shared hub and tell the user how it went. Used by the
	home Sync card and the /sync page, so both word the outcome the same way.
*/
import Notifier from '#lib/utils/notifier';
import type { ChannelId } from './channel';
import { syncHub } from './hub';

export async function checkWithNotice(id: ChannelId, label: string) {
	const s = await syncHub.check(id);
	if (s.status === 'error') Notifier.error(`${label} check failed: ${s.error}`);
}

export async function syncWithNotice(id: ChannelId, label: string) {
	const r = await syncHub.sync(id);
	if (!r.ok) Notifier.error(`${label} sync failed: ${r.errors.join('; ')}`);
	else
		Notifier.success(r.merged ? `${label} synced — new transactions received` : `${label} synced`);
}
