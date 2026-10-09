/*
    xactStoreRegistry tests: the working-set store is the CRDT store, created
    once and shared. The registry keeps module-level state, so each test loads
    a fresh copy of it.
*/
import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));

async function load() {
	vi.resetModules();
	const registry = await import('#lib/storage/xactStoreRegistry');
	return { registry };
}

describe('getXactStore', () => {
	it('returns the CRDT store', async () => {
		const { registry } = await load();
		const { CrdtXactStore } = await import('#lib/storage/crdtXactStore');

		expect(await registry.getXactStore()).toBeInstanceOf(CrdtXactStore);
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
		const fake = {} as never;

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
