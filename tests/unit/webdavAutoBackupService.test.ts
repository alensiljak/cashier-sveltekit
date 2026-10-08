/*
    Automatic WebDAV backup: debouncing, the guard conditions, and what gets
    uploaded. Settings run on fake IndexedDB; the WebDAV client and the store
    registry are mocked.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const mocks = vi.hoisted(() => ({
	put: vi.fn(),
	clientArgs: [] as unknown[][],
	getXactStore: vi.fn(),
	notify: vi.fn(),
	notifyFailure: vi.fn()
}));
vi.mock('$lib/utils/webdav', () => ({
	WebDavClient: class {
		constructor(...args: unknown[]) {
			mocks.clientArgs.push(args);
		}
		put = mocks.put;
	}
}));
vi.mock('$lib/storage/xactStoreRegistry', () => ({ getXactStore: mocks.getXactStore }));
vi.mock('$lib/utils/notifier', () => ({
	default: { success: mocks.notify, error: mocks.notifyFailure }
}));

import { DeviceSettingKeys, SettingKeys, deviceSettings, settings } from '$lib/settings';
import {
	crdtBackupFilename,
	lastBackupTime,
	scheduleBackup
} from '$lib/services/webdavAutoBackupService';
import { getDeviceId, ydocFilename } from '$lib/sync/ydocDevices';

const STATE = new Uint8Array([1, 2, 3]);
const CFG = { url: 'https://dav.example.com/', username: 'alice', password: 'pw' };

async function configure({ enabled = true, cfg = CFG as unknown } = {}) {
	await deviceSettings.set(DeviceSettingKeys.webdavAutoBackup, enabled);
	await settings.set(SettingKeys.webdavSettings, cfg);
}

/** Runs the debounce timer and waits until the scheduled upload has finished. The service is fire-and-forget, so completion is the success/failure message. */
async function runBackup() {
	scheduleBackup();
	await vi.advanceTimersByTimeAsync(2000);
	// The upload continues asynchronously after the timer fires.
	await vi.waitFor(() =>
		expect(mocks.notify.mock.calls.length + mocks.notifyFailure.mock.calls.length).toBeGreaterThan(
			0
		)
	);
}

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	mocks.put.mockReset().mockImplementation(async () => {
		return new Response('', { status: 201 });
	});
	mocks.clientArgs.length = 0;
	mocks.getXactStore.mockReset().mockResolvedValue({ exportState: async () => STATE });
	mocks.notify.mockReset();
	mocks.notifyFailure.mockReset();
	lastBackupTime.set(null);
	await configure();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
	// A fired backup may still be awaiting its lazy imports; let it settle (and hit its guards)
	// under this test's settings and mocks rather than the next test's.
	await vi.advanceTimersByTimeAsync(2000);
	vi.useRealTimers();
	await new Promise((resolve) => setTimeout(resolve, 50));
	vi.restoreAllMocks();
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
		// Let the upload finish so it can't touch shared state during a later test.
		await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());
	});

	it('coalesces rapid calls into one upload', async () => {
		scheduleBackup();
		await vi.advanceTimersByTimeAsync(1000);
		scheduleBackup();
		await vi.advanceTimersByTimeAsync(1000);
		scheduleBackup();
		await vi.advanceTimersByTimeAsync(2000);
		await vi.waitFor(() => expect(mocks.put).toHaveBeenCalled());

		await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());

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

describe('upload', () => {
	it('uploads the Yjs state to this device’s own file with the configured credentials', async () => {
		await runBackup();

		expect(mocks.clientArgs[0]).toEqual([CFG.url, CFG.username, CFG.password]);
		expect(mocks.put).toHaveBeenCalledWith(
			await crdtBackupFilename(),
			STATE,
			'application/octet-stream'
		);
		expect(get(lastBackupTime)).toBeInstanceOf(Date);
		expect(mocks.notify).toHaveBeenCalled();
	});

	it('warns instead of throwing when the server rejects the upload', async () => {
		mocks.put.mockImplementation(async () => {
			return new Response('', { status: 507, statusText: 'Insufficient Storage' });
		});

		await runBackup();

		await vi.waitFor(() =>
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('upload failed'),
				expect.arrayContaining([expect.stringContaining('507')])
			)
		);
		expect(get(lastBackupTime)).toBeNull();
		expect(mocks.notify).not.toHaveBeenCalled();
		expect(mocks.notifyFailure).toHaveBeenCalledWith(
			expect.stringMatching(/^WebDAV backup failed: .*507/)
		);
	});

	it('warns when exporting or uploading fails', async () => {
		mocks.getXactStore.mockResolvedValue({
			exportState: async () => {
				throw new Error('export failed');
			}
		});

		await runBackup();

		await vi.waitFor(() =>
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('upload failed'),
				expect.arrayContaining(['export failed'])
			)
		);
		expect(mocks.notifyFailure).toHaveBeenCalledWith('WebDAV backup failed: export failed');
	});
});
