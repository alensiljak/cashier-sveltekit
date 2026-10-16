/*
    The WebDAV folder as a delta-sync store: the protocol's keys are flat file names, and two
    devices can sync through it.
*/
import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/utils/notifier', () => ({ default: { warning: vi.fn() } }));
vi.mock('#lib/services/webdavAutoBackupService', () => ({ scheduleBackup: vi.fn() }));

import { CrdtXactStore } from '#lib/storage/crdtXactStore';
import { DeltaSync, deltaKey, parseKey, type DeltaState } from '#lib/sync/deltaSync';
import { fileNameOf, keyOfFile, WebDavRemoteStore } from '#lib/services/webdavRemoteStore';
import type { WebDavClient } from '#lib/utils/webdav';

/** A WebDAV folder in memory, as much of `WebDavClient` as the adapter uses. */
class FakeClient {
	files = new Map<string, { body: Uint8Array; lastModified: Date }>();
	status = 0;

	async list() {
		return [
			{ name: 'settings.json.gz', isDirectory: false, size: 5, lastModified: null },
			{ name: 'archive', isDirectory: true, size: null, lastModified: null },
			...[...this.files].map(([name, f]) => ({
				name,
				isDirectory: false,
				size: f.body.length,
				lastModified: f.lastModified
			}))
		];
	}
	async get(name: string) {
		const f = this.files.get(name);
		return f ? new Response(f.body as BlobPart) : new Response('', { status: 404 });
	}
	async put(name: string, body: Uint8Array) {
		if (this.status) return new Response('', { status: this.status, statusText: 'No' });
		this.files.set(name, { body: body.slice(), lastModified: new Date() });
		return new Response('', { status: 201 });
	}
	async delete(name: string) {
		this.files.delete(name);
		return new Response('', { status: 404 });
	}
	async lastModified(name: string) {
		return this.files.get(name)?.lastModified ?? null;
	}
}

const asClient = (c: FakeClient) => c as unknown as WebDavClient;

describe('file names', () => {
	it('maps a key to a flat file name and back', () => {
		expect(fileNameOf('crdt/xacts/dev1.000007.upd')).toBe('cashier-xacts-dev1.000007.upd');
		expect(keyOfFile('cashier-xacts-dev1.000007.upd')).toBe('crdt/xacts/dev1.000007.upd');
		expect(keyOfFile('cashier-scx-snap-01ABC.ydoc')).toBe('crdt/scx/snap-01ABC.ydoc');
	});

	it('still finds the per-device state files of the older versions, as legacy files', () => {
		const key = keyOfFile('cashier-xacts-dev1.ydoc')!;
		expect(parseKey('xacts', key)).toEqual({ type: 'legacy', deviceId: 'dev1' });
	});

	it('leaves other files in the folder alone', () => {
		expect(keyOfFile('settings.json.gz')).toBeNull();
		expect(keyOfFile('cashier-other-dev1.ydoc')).toBeNull();
		expect(fileNameOf('data/settings.json')).toBeNull();
	});
});

describe('WebDavRemoteStore', () => {
	it('lists only the sync files under a prefix, with their size and time', async () => {
		const dav = new FakeClient();
		const store = new WebDavRemoteStore(asClient(dav));
		await store.put('crdt/xacts/dev1.000001.upd', new Uint8Array([1, 2, 3]));
		await store.put('crdt/scx/dev1.000001.upd', new Uint8Array([1]));

		const infos = await store.list('crdt/xacts/');
		expect(infos.map((i) => [i.key, i.size])).toEqual([['crdt/xacts/dev1.000001.upd', 3]]);
		expect(infos[0].lastModified).toBeInstanceOf(Date);
	});

	it('reads what it wrote, and null for a missing file', async () => {
		const store = new WebDavRemoteStore(asClient(new FakeClient()));
		await store.put('crdt/xacts/a.ack', new Uint8Array([4, 5]));

		expect(Array.from((await store.get('crdt/xacts/a.ack'))!)).toEqual([4, 5]);
		expect(await store.get('crdt/xacts/missing.ack')).toBeNull();
	});

	it('does not overwrite when asked not to', async () => {
		const store = new WebDavRemoteStore(asClient(new FakeClient()));
		await store.put('crdt/xacts/a.000001.upd', new Uint8Array([1]));

		expect(
			await store.put('crdt/xacts/a.000001.upd', new Uint8Array([2]), { onlyIfAbsent: true })
		).toBe(false);
		expect(Array.from((await store.get('crdt/xacts/a.000001.upd'))!)).toEqual([1]);
	});

	it('deletes, and does not mind a file that is already gone', async () => {
		const store = new WebDavRemoteStore(asClient(new FakeClient()));
		await store.put('crdt/xacts/a.000001.upd', new Uint8Array([1]));

		await store.delete('crdt/xacts/a.000001.upd');
		await store.delete('crdt/xacts/a.000001.upd');
		expect(await store.list('crdt/')).toEqual([]);
	});

	it('reports a server that refuses the write', async () => {
		const dav = new FakeClient();
		dav.status = 507;
		const store = new WebDavRemoteStore(asClient(dav));

		await expect(store.put('crdt/xacts/a.000001.upd', new Uint8Array([1]))).rejects.toThrow(/507/);
	});

	it('refuses a key that is not a sync object', async () => {
		const store = new WebDavRemoteStore(asClient(new FakeClient()));
		await expect(store.get('data/settings.json')).rejects.toThrow(/Not a sync object/);
	});
});

describe('two devices through a WebDAV folder', () => {
	let counter = 0;
	const xact = (payee: string) => `2025-01-01 * "${payee}" "Food"
  Expenses:Groceries   10.00 EUR
  Assets:Bank:Checking
`;

	async function device(dav: FakeClient, id: string) {
		const store = new CrdtXactStore(`test-webdav-delta-${++counter}`, async () => id);
		await store.initialize();
		let saved: DeltaState | null = null;
		const sync = new DeltaSync({
			kind: 'xacts',
			deviceId: id,
			doc: store,
			remote: new WebDavRemoteStore(asClient(dav)),
			storage: { load: async () => saved, save: async (s) => void (saved = structuredClone(s)) }
		});
		await sync.attach();
		return { store, sync };
	}

	it('exchange deltas, acknowledge and compact', async () => {
		const dav = new FakeClient();
		const a = await device(dav, 'A');
		const b = await device(dav, 'B');
		for (const p of ['One', 'Two']) {
			await a.store.append(xact(p));
			await a.sync.upload();
		}
		expect([...dav.files.keys()]).toEqual([
			'cashier-xacts-A.000001.upd',
			'cashier-xacts-A.000002.upd'
		]);

		await b.sync.download();
		expect((await b.store.list()).map((x) => x.xact.payee).sort()).toEqual(['One', 'Two']);
		expect(await b.sync.publishAck()).toBe(true);
		expect(dav.files.has('cashier-xacts-B.ack')).toBe(true);

		const result = await a.sync.compactIfDue({ isActive: () => true, force: true });
		expect(result?.snapshot).toBeTruthy();
		const names = [...dav.files.keys()];
		expect(names.filter((n) => n.endsWith('.upd'))).toEqual([]);
		expect(names.some((n) => /^cashier-xacts-snap-.+\.ydoc$/.test(n))).toBe(true);

		const c = await device(dav, 'C');
		await c.sync.download();
		expect((await c.store.list()).map((x) => x.xact.payee).sort()).toEqual(['One', 'Two']);
		expect(deltaKey('xacts', 'A', 1)).toBe('crdt/xacts/A.000001.upd');
	});
});
