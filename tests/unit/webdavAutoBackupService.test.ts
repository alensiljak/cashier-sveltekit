/*
    Automatic WebDAV backup: debouncing, the guard conditions, and what gets
    uploaded for each store kind. Settings run on fake IndexedDB; the WebDAV
    client, OPFS and the store registry are mocked.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const mocks = vi.hoisted(() => ({
	put: vi.fn(),
	lastModified: vi.fn(),
	clientArgs: [] as unknown[][],
	readFile: vi.fn(),
	getXactStore: vi.fn(),
	notify: vi.fn()
}));
vi.mock('$lib/utils/webdav', () => ({
	WebDavClient: class {
		constructor(...args: unknown[]) {
			mocks.clientArgs.push(args);
		}
		put = mocks.put;
		lastModified = mocks.lastModified;
	}
}));
vi.mock('$lib/utils/opfslib', () => ({ readFile: mocks.readFile }));
vi.mock('$lib/storage/xactStoreRegistry', () => ({ getXactStore: mocks.getXactStore }));
vi.mock('$lib/utils/webNotification', () => ({ showBackupNotification: mocks.notify }));

import { DeviceSettingKeys, SettingKeys, deviceSettings, settings } from '$lib/settings';
import {
	contentHash,
	crdtBackupFilename,
	lastBackupTime,
	scheduleBackup,
	updateCashierBeanBaseline,
	type WebDavLastSyncTs
} from '$lib/services/webdavAutoBackupService';
import { getDeviceId, ydocFilename } from '$lib/sync/ydocDevices';

const CFG = { url: 'https://dav.example.com/', username: 'alice', password: 'pw' };

async function configure({ enabled = true, cfg = CFG as unknown } = {}) {
	await deviceSettings.set(DeviceSettingKeys.webdavAutoBackup, enabled);
	await settings.set(SettingKeys.webdavSettings, cfg);
}

// The service is fire-and-forget, so completion is detected through its first awaited
// collaborator: each mock upload/export sets this flag when it is reached.
let settledFlag = false;

/** Runs the debounce timer and waits until the scheduled upload has finished. */
async function runBackup() {
	scheduleBackup();
	await vi.advanceTimersByTimeAsync(2000);
	// The upload continues asynchronously after the timer fires.
	await vi.waitFor(() => expect(settledFlag).toBe(true));
}

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	settledFlag = false;
	mocks.put.mockReset().mockImplementation(async () => {
		settledFlag = true;
		return new Response('', { status: 201 });
	});
	mocks.lastModified.mockReset().mockResolvedValue(new Date('2026-08-15T10:00:00Z'));
	mocks.clientArgs.length = 0;
	mocks.readFile.mockReset().mockResolvedValue('2026-08-10 * "Shop"\n');
	mocks.getXactStore.mockReset().mockResolvedValue({ kind: 'opfs' });
	mocks.notify.mockReset();
	lastBackupTime.set(null);
	await configure();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('contentHash', () => {
	it('is a SHA-256 hex digest', async () => {
		expect(await contentHash('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});

	it('ignores line-ending differences', async () => {
		expect(await contentHash('a\r\nb\r\n')).toBe(await contentHash('a\nb\n'));
	});
});

describe('updateCashierBeanBaseline', () => {
	it('records the remote timestamp and local hash, keeping the other baselines', async () => {
		await deviceSettings.set(DeviceSettingKeys.webdavLastSyncTs, {
			settings: 'S',
			cashierBean: null,
			scheduled: 'X'
		});

		await updateCashierBeanBaseline('content', new Date('2026-08-15T10:00:00Z'));

		const stored = await deviceSettings.get<WebDavLastSyncTs>(DeviceSettingKeys.webdavLastSyncTs);
		expect(stored).toEqual({
			settings: 'S',
			scheduled: 'X',
			cashierBean: {
				remoteTs: '2026-08-15T10:00:00.000Z',
				localHash: await contentHash('content')
			}
		});
	});
});

describe('crdtBackupFilename', () => {
	it('is this device’s own Yjs file', async () => {
		expect(await crdtBackupFilename()).toBe(ydocFilename(await getDeviceId()));
	});
});

describe('scheduleBackup', () => {
	it('waits for the debounce period before uploading', async () => {
		scheduleBackup();
		await vi.advanceTimersByTimeAsync(1999);

		expect(mocks.put).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		await vi.waitFor(() => expect(mocks.put).toHaveBeenCalled());
	});

	it('coalesces rapid calls into one upload', async () => {
		scheduleBackup();
		await vi.advanceTimersByTimeAsync(1000);
		scheduleBackup();
		await vi.advanceTimersByTimeAsync(1000);
		scheduleBackup();
		await vi.advanceTimersByTimeAsync(2000);
		await vi.waitFor(() => expect(mocks.put).toHaveBeenCalled());

		expect(mocks.put).toHaveBeenCalledTimes(1);
	});
});

describe('guards', () => {
	it('does nothing when auto-backup is off', async () => {
		await configure({ enabled: false });

		scheduleBackup();
		await vi.advanceTimersByTimeAsync(2000);
		await vi.advanceTimersByTimeAsync(50);

		expect(mocks.put).not.toHaveBeenCalled();
	});

	it('does nothing without a configured server URL', async () => {
		await configure({ cfg: { url: '', username: '', password: '' } });

		scheduleBackup();
		await vi.advanceTimersByTimeAsync(2000);
		await vi.advanceTimersByTimeAsync(50);

		expect(mocks.put).not.toHaveBeenCalled();
	});

	it('does nothing while offline', async () => {
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

		scheduleBackup();
		await vi.advanceTimersByTimeAsync(2000);
		await vi.advanceTimersByTimeAsync(50);

		expect(mocks.put).not.toHaveBeenCalled();
	});
});

describe('OPFS store', () => {
	it('uploads cashier.bean with the configured credentials', async () => {
		await runBackup();

		expect(mocks.clientArgs[0]).toEqual([CFG.url, CFG.username, CFG.password]);
		expect(mocks.put).toHaveBeenCalledWith('cashier.bean', '2026-08-10 * "Shop"\n');
		expect(get(lastBackupTime)).toBeInstanceOf(Date);
		expect(mocks.notify).toHaveBeenCalled();
	});

	it('updates the sync baseline from the server timestamp', async () => {
		await runBackup();

		await vi.waitFor(async () => {
			const stored = await deviceSettings.get<WebDavLastSyncTs>(DeviceSettingKeys.webdavLastSyncTs);
			expect(stored?.cashierBean).toMatchObject({ remoteTs: '2026-08-15T10:00:00.000Z' });
		});
	});

	it('skips the upload when cashier.bean does not exist', async () => {
		mocks.readFile.mockResolvedValue(undefined);

		scheduleBackup();
		await vi.advanceTimersByTimeAsync(2000);
		await vi.advanceTimersByTimeAsync(50);

		expect(mocks.put).not.toHaveBeenCalled();
	});

	it('warns instead of throwing when the server rejects the upload', async () => {
		mocks.put.mockImplementation(async () => {
			settledFlag = true;
			return new Response('', { status: 507, statusText: 'Insufficient Storage' });
		});

		await runBackup();

		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('PUT failed: 507'));
		expect(get(lastBackupTime)).toBeNull();
		expect(mocks.notify).not.toHaveBeenCalled();
	});

	it('warns instead of throwing when the network fails', async () => {
		mocks.put.mockImplementation(async () => {
			settledFlag = true;
			throw new Error('network down');
		});

		await runBackup();

		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('Upload error'),
			expect.any(Error)
		);
		expect(get(lastBackupTime)).toBeNull();
	});
});

describe('CRDT store', () => {
	it('uploads the Yjs state to this device’s own file', async () => {
		const state = new Uint8Array([1, 2, 3]);
		mocks.getXactStore.mockResolvedValue({ kind: 'crdt', exportState: async () => state });

		await runBackup();

		expect(mocks.put).toHaveBeenCalledWith(
			await crdtBackupFilename(),
			state,
			'application/octet-stream'
		);
		expect(mocks.readFile).not.toHaveBeenCalled();
		expect(get(lastBackupTime)).toBeInstanceOf(Date);
	});

	it('warns when exporting or uploading fails', async () => {
		mocks.getXactStore.mockResolvedValue({
			kind: 'crdt',
			exportState: async () => {
				settledFlag = true;
				throw new Error('export failed');
			}
		});

		await runBackup();

		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('Yjs upload error'),
			expect.any(Error)
		);
	});
});
