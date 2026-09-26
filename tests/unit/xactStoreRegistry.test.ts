/*
    xactStoreRegistry tests: which working-set store is chosen, and that the
    choice is made once and shared. The registry keeps module-level state, so
    each test loads a fresh copy of it.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

const opfsFiles = vi.hoisted(() => new Set<string>());
vi.mock('$lib/utils/opfslib', () => ({
	fileExists: vi.fn(async (name: string) => opfsFiles.has(name))
}));
vi.mock('$lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));

async function load() {
	vi.resetModules();
	const registry = await import('$lib/storage/xactStoreRegistry');
	const { DeviceSettingKeys, deviceSettings } = await import('$lib/settings');
	return { registry, DeviceSettingKeys, deviceSettings };
}

beforeEach(async () => {
	opfsFiles.clear();
	// Forget any saved choice from a previous test.
	const { deviceSettings, DeviceSettingKeys } = await load();
	await deviceSettings.set(DeviceSettingKeys.xactStore, undefined as unknown as string);
});

describe('getXactStore', () => {
	it('defaults to CRDT for a new install and remembers the choice', async () => {
		const { registry, deviceSettings, DeviceSettingKeys } = await load();

		expect((await registry.getXactStore()).kind).toBe('crdt');
		expect(await deviceSettings.get(DeviceSettingKeys.xactStore)).toBe('crdt');
	});

	it('keeps OPFS when a legacy cashier.bean exists, and remembers it', async () => {
		opfsFiles.add('cashier.bean');
		const { registry, deviceSettings, DeviceSettingKeys } = await load();

		expect((await registry.getXactStore()).kind).toBe('opfs');
		expect(await deviceSettings.get(DeviceSettingKeys.xactStore)).toBe('opfs');
	});

	it('honours an explicit setting over the legacy file check', async () => {
		opfsFiles.add('cashier.bean');
		const { registry, deviceSettings, DeviceSettingKeys } = await load();
		await deviceSettings.set(DeviceSettingKeys.xactStore, 'crdt');

		expect((await registry.getXactStore()).kind).toBe('crdt');
	});

	it('falls back to OPFS for an unrecognised setting', async () => {
		const { registry, deviceSettings, DeviceSettingKeys } = await load();
		await deviceSettings.set(DeviceSettingKeys.xactStore, 'something-new');

		expect((await registry.getXactStore()).kind).toBe('opfs');
	});

	it('hands out the same store to every caller, whichever comes first', async () => {
		const { registry } = await load();

		const [a, b] = await Promise.all([registry.getXactStore(), registry.getXactStore()]);

		expect(a).toBe(b);
		expect(await registry.getXactStore()).toBe(a);
	});
});

describe('setXactStore', () => {
	it('replaces the active store', async () => {
		const { registry } = await load();
		const fake = { kind: 'opfs' } as never;

		registry.setXactStore(fake);

		expect(await registry.getXactStore()).toBe(fake);
	});
});

describe('subscribeXactStore', () => {
	it('forwards store changes to the callback and stops after unsubscribe', async () => {
		const { registry } = await load();
		let listener: (() => void) | undefined;
		const unsubscribeStore = vi.fn();
		registry.setXactStore({
			subscribe: (cb: () => void) => {
				listener = cb;
				return unsubscribeStore;
			}
		} as never);
		const callback = vi.fn();

		const unsubscribe = registry.subscribeXactStore(callback);
		await vi.waitFor(() => expect(listener).toBeDefined());
		listener!();
		expect(callback).toHaveBeenCalledTimes(1);

		unsubscribe();
		expect(unsubscribeStore).toHaveBeenCalled();
	});

	it('does not subscribe if cancelled before the store resolved', async () => {
		const { registry } = await load();
		const subscribe = vi.fn(() => () => {});
		registry.setXactStore({ subscribe } as never);

		registry.subscribeXactStore(() => {})();
		await Promise.resolve();
		await Promise.resolve();

		expect(subscribe).not.toHaveBeenCalled();
	});
});
