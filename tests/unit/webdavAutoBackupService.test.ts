/*
    Automatic WebDAV backup: debouncing, the guard conditions, and what gets uploaded. Settings run
    on fake IndexedDB; the WebDAV client is an in-memory folder; the working set store is real.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const mocks = vi.hoisted(() => ({
	/** The WebDAV folder: file name -> content. */
	files: new Map<string, Uint8Array>(),
	/** Names of the files PUT, in order. */
	puts: [] as string[],
	putStatus: 201,
	clientArgs: [] as unknown[][],
	getXactStore: vi.fn(),
	notify: vi.fn(),
	notifyFailure: vi.fn()
}));
vi.mock('#lib/utils/webdav', () => ({
	WebDavClient: class {
		constructor(...args: unknown[]) {
			mocks.clientArgs.push(args);
		}
		fileUrl = (name: string) => `https://dav.example.com/${name}`;
		put = async (name: string, body: Uint8Array) => {
			mocks.puts.push(name);
			if (mocks.putStatus !== 201) {
				return new Response('', { status: mocks.putStatus, statusText: 'Insufficient Storage' });
			}
			mocks.files.set(name, body);
			return new Response('', { status: 201 });
		};
		get = async (name: string) => {
			const body = mocks.files.get(name);
			return body ? new Response(body as BlobPart) : new Response('', { status: 404 });
		};
		list = async () =>
			[...mocks.files].map(([name, body]) => ({
				name,
				isDirectory: false,
				size: body.length,
				lastModified: new Date()
			}));
		exists = async (name: string) => mocks.files.has(name);
		lastModified = async (name: string) => (mocks.files.has(name) ? new Date() : null);
		delete = async (name: string) => {
			mocks.files.delete(name);
			return new Response('', { status: 204 });
		};
	}
}));
vi.mock('#lib/storage/xactStoreRegistry', () => ({ getXactStore: mocks.getXactStore }));
vi.mock('#lib/utils/notifier', () => ({
	default: { success: mocks.notify, error: mocks.notifyFailure, warning: vi.fn() }
}));

import db from '#lib/data/db';
import { DeviceSettingKeys, SettingKeys, deviceSettings, settings } from '#lib/settings';
import { lastBackupTime, scheduleBackup } from '#lib/services/webdavAutoBackupService';
import { CrdtXactStore } from '#lib/storage/crdtXactStore';
import { getDeviceId } from '#lib/sync/ydocDevices';

const CFG = { url: 'https://dav.example.com/', username: 'alice', password: 'pw' };

const xact = `2025-01-01 * "Shop" "Food"
  Expenses:Groceries   10.00 EUR
  Assets:Bank:Checking
`;

let dbCounter = 0;

async function configure({ enabled = true, cfg = CFG as unknown } = {}) {
	await deviceSettings.set(DeviceSettingKeys.webdavAutoBackup, enabled);
	await settings.set(SettingKeys.webdavSettings, cfg);
}

/** A working set with one transaction in it, so that there is something to upload. */
async function newStore() {
	const store = new CrdtXactStore(`test-webdav-backup-${++dbCounter}`, async () => 'A');
	await store.initialize();
	await store.append(xact);
	return store;
}

const deltaPuts = () => mocks.puts.filter((n) => n.endsWith('.upd'));

/** Runs the debounce timer and waits until the scheduled upload has finished. The service is fire-and-forget, so completion is the success/failure message. */
async function runBackup() {
	scheduleBackup('xacts');
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
	mocks.files.clear();
	mocks.puts.length = 0;
	mocks.putStatus = 201;
	mocks.clientArgs.length = 0;
	mocks.getXactStore.mockReset().mockResolvedValue(await newStore());
	mocks.notify.mockReset();
	mocks.notifyFailure.mockReset();
	lastBackupTime.set(null);
	// What a previous test left as the delta-sync progress would say the folder holds more than it does.
	await db.deviceSettings.clear();
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

describe('scheduleBackup', () => {
	it('waits for the debounce period before uploading', async () => {
		scheduleBackup('xacts');
		await vi.advanceTimersByTimeAsync(1999);

		expect(mocks.puts).toEqual([]);

		await vi.advanceTimersByTimeAsync(1);
		await vi.waitFor(() => expect(deltaPuts()).toHaveLength(1));
		// Let the upload finish so it can't touch shared state during a later test.
		await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());
	});

	it('coalesces rapid calls into one upload', async () => {
		scheduleBackup('xacts');
		await vi.advanceTimersByTimeAsync(1000);
		scheduleBackup('xacts');
		await vi.advanceTimersByTimeAsync(1000);
		scheduleBackup('xacts');
		await vi.advanceTimersByTimeAsync(2000);
		await vi.waitFor(() => expect(deltaPuts()).toHaveLength(1));

		await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());

		expect(deltaPuts()).toHaveLength(1);
	});
});

describe('guards', () => {
	it('does nothing when auto-backup is off', async () => {
		await configure({ enabled: false });

		scheduleBackup('xacts');
		await vi.advanceTimersByTimeAsync(2000);
		await vi.advanceTimersByTimeAsync(50);

		expect(mocks.puts).toEqual([]);
	});

	it('does nothing without a configured server URL', async () => {
		await configure({ cfg: { url: '', username: '', password: '' } });

		scheduleBackup('xacts');
		await vi.advanceTimersByTimeAsync(2000);
		await vi.advanceTimersByTimeAsync(50);

		expect(mocks.puts).toEqual([]);
	});

	it('does nothing while offline', async () => {
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

		scheduleBackup('xacts');
		await vi.advanceTimersByTimeAsync(2000);
		await vi.advanceTimersByTimeAsync(50);

		expect(mocks.puts).toEqual([]);
	});
});

describe('upload', () => {
	it('uploads the changes as a numbered delta of this device, with the configured credentials', async () => {
		await runBackup();

		expect(mocks.clientArgs[0]).toEqual([CFG.url, CFG.username, CFG.password]);
		expect(deltaPuts()).toEqual([`cashier-xacts-${await getDeviceId()}.000001.upd`]);
		expect(get(lastBackupTime)).toBeInstanceOf(Date);
		expect(mocks.notify).toHaveBeenCalled();
	});

	it('uploads only what changed the next time', async () => {
		const store = (await mocks.getXactStore()) as CrdtXactStore;
		for (let i = 0; i < 4; i++) await store.append(xact);
		await runBackup();
		const first = mocks.files.get(deltaPuts()[0])!.length;
		await store.append(xact);
		mocks.notify.mockReset();

		await runBackup();

		const second = deltaPuts()[1];
		expect(second).toMatch(/\.000002\.upd$/);
		expect(mocks.files.get(second)!.length).toBeLessThan(first);
	});

	it('warns instead of throwing when the server rejects the upload', async () => {
		mocks.putStatus = 507;

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

	it('warns when reading the store fails', async () => {
		mocks.getXactStore.mockResolvedValue({
			onUpdate: () => () => {},
			stateVector: async () => {
				throw new Error('export failed');
			},
			exportState: async () => new Uint8Array(),
			exportDelta: async () => new Uint8Array(),
			importState: async () => []
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
