/**
 * Moves this device from its legacy UUID to the ID derived from its key (doc/projects/
 * 2026-11-11_device-identity.md, step 5c).
 *
 * It happens once, at launch, when everything this device wrote is in the bucket: nothing waits to
 * be uploaded for any S3 bucket or WebDAV folder it syncs with. A device that syncs with none
 * switches at once. After the switch:
 * - the others find it by the same key (or a confirmation, see identityMigration.ts) and keep the
 *   old UUID in `legacyIds`;
 * - its first full sync under the new ID removes its objects from the bucket (`DeltaSync.retire`);
 * - the UUID stays in `DeviceSettingKeys.previousDeviceId` for good: records it created carry it as
 *   their origin, and a device that has not seen the switch yet finds it in the hello.
 */
import { deviceSettings, DeviceSettingKeys } from '#lib/settings';
import { isDerivedId } from '#lib/sync/deviceId';
import { deviceIdFromPublicKey, getDeviceKey } from '#lib/sync/deviceKey';
import type { DocKind } from '#lib/sync/ydocDevices';

export type SwitchResult =
	| { switched: true; id: string; previousId: string }
	| { switched: false; reason: 'not-needed' | 'unsent-changes' };

/** Whether any store has changes that a configured bucket or folder has not received. Local only. */
async function hasUnsentChanges(currentId: string): Promise<boolean> {
	const { configuredRemoteIds, getDeltaSync, notConnected } =
		await import('#lib/sync/deltaSyncRegistry');
	const remoteIds = await configuredRemoteIds();
	if (!remoteIds.length) return false;

	const { getXactStore } = await import('#lib/storage/xactStoreRegistry');
	const { getScxStore } = await import('#lib/storage/scxStoreRegistry');
	const scx = await getScxStore();
	const stores: [DocKind, object][] = [['xacts', await getXactStore()]];
	// Scheduled transactions only count once they were set up here.
	if (await scx.isInitialized()) stores.push(['scx', scx]);

	for (const [kind, store] of stores) {
		for (const remoteId of remoteIds) {
			const sync = await getDeltaSync({
				kind,
				deviceId: currentId,
				store: store as never,
				remote: notConnected,
				remoteId
			});
			if (await sync.hasUpload()) return true;
		}
	}
	return false;
}

/** Switches to the key-derived ID when it is safe to. Safe to call on every launch. */
export async function switchDeviceIdIfReady(): Promise<SwitchResult> {
	const current = await deviceSettings.get<string>(DeviceSettingKeys.peerId);
	// A new device derives its ID at first use; one that switched has nothing more to do.
	if (!current || isDerivedId(current)) return { switched: false, reason: 'not-needed' };
	if (await hasUnsentChanges(current)) return { switched: false, reason: 'unsent-changes' };

	const id = await deviceIdFromPublicKey((await getDeviceKey()).publicKey);
	// The old ID is recorded first: if the launch ends in between, the next one finishes the switch.
	await deviceSettings.set(DeviceSettingKeys.previousDeviceId, current);
	await deviceSettings.set(DeviceSettingKeys.peerId, id);

	// Syncs that were set up under the old ID are rebuilt under the new one on their next use.
	const { resetDeltaSyncRegistry } = await import('#lib/sync/deltaSyncRegistry');
	resetDeltaSyncRegistry();
	return { switched: true, id, previousId: current };
}
