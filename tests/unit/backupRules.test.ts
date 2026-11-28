/*
    The backup rules. That every declared key has one is checked by the type check; these tests
    cover what the types cannot: that what is written also comes back.
*/
import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));
vi.mock('#lib/sync/ydocDevices', async (orig) => ({
	...(await orig<typeof import('#lib/sync/ydocDevices')>()),
	getDeviceId: vi.fn(async () => 'this-device')
}));

import db from '#lib/data/db';
import {
	DeviceSettingKeys,
	deviceSettings,
	isSharedSettingKey,
	SettingKeys,
	settings
} from '#lib/settings';
import { createBackup, restoreBackup } from '#lib/services/backup';
import { DEVICE_RULES, PORTABLE_DEVICE_KEYS, SHARED_RULES } from '#lib/services/backup/rules';

describe('shared settings', () => {
	it('do not take the key of a device setting, also one that looks like an importer config', () => {
		// Never called: `npm run check` fails if one of these starts to compile.
		void (() => [
			// @ts-expect-error a device credential
			settings.set(DeviceSettingKeys.scalableTokens, {}),
			// @ts-expect-error a device credential
			settings.set(DeviceSettingKeys.enableBankingCredentials, {}),
			// @ts-expect-error not declared at all
			settings.set('unknown', 1)
		]);

		expect(isSharedSettingKey(DeviceSettingKeys.scalableTokens)).toBe(false);
		expect(isSharedSettingKey('importer.scalable')).toBe(true);
		expect(isSharedSettingKey(SettingKeys.currency)).toBe(true);
	});
});

describe('backup rules', () => {
	it('cover every declared key', () => {
		expect(Object.keys(SHARED_RULES).sort()).toEqual(Object.values(SettingKeys).sort());
		expect(Object.keys(DEVICE_RULES).sort()).toEqual(Object.values(DeviceSettingKeys).sort());
	});

	// A key that is written but missing from the latest reader would be dropped without a word.
	it('bring back every device setting they write', async () => {
		for (const key of PORTABLE_DEVICE_KEYS) {
			await deviceSettings.set(key as typeof DeviceSettingKeys.peerName, 'value');
		}
		const file = await createBackup({ sections: ['device'] });
		await db.deviceSettings.clear();

		await restoreBackup(file);

		const restored = (await db.deviceSettings.toArray()).map((s: { key: string }) => s.key);
		expect(restored).toEqual(expect.arrayContaining(PORTABLE_DEVICE_KEYS));
	});
});
