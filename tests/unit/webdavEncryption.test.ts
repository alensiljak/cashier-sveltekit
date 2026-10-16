/*
    Encryption of the sync files in the WebDAV folder: the switch, the key file that marks a folder
    as encrypted, refusing to sync when the two disagree, and converting the folder either way.
*/
import { beforeEach, describe, expect, it } from 'vitest';
import db from '#lib/data/db';
import { EncryptedRemoteStore } from '#lib/services/encryptedRemoteStore';
import { createKeyParams, WrongPassphraseError } from '#lib/services/s3Crypto';
import {
	EncryptionMismatchError,
	KEY_FILE,
	convertWebDavFolder,
	loadWebDavEncryption,
	remoteFor,
	saveWebDavEncryption,
	webDavFolderState
} from '#lib/services/webdavEncryption';
import { WebDavRemoteStore } from '#lib/services/webdavRemoteStore';
import { MemoryRemoteStore } from '#lib/sync/remoteStore';
import type { WebDavClient } from '#lib/utils/webdav';

/** A WebDAV folder in memory, as much of `WebDavClient` as encryption uses. */
class FakeClient {
	files = new Map<string, Uint8Array>();
	fileUrl = (name: string) => `https://dav.example.com/${name}`;

	async list() {
		return [...this.files].map(([name, body]) => ({
			name,
			isDirectory: false,
			size: body.length,
			lastModified: new Date()
		}));
	}
	async get(name: string) {
		const body = this.files.get(name);
		return body ? new Response(body as BlobPart) : new Response('', { status: 404 });
	}
	async put(name: string, body: string | Uint8Array) {
		this.files.set(name, typeof body === 'string' ? new TextEncoder().encode(body) : body.slice());
		return new Response('', { status: 201 });
	}
	async delete(name: string) {
		const had = this.files.delete(name);
		return new Response(null, { status: had ? 204 : 404 });
	}
	async lastModified(name: string) {
		return this.files.has(name) ? new Date() : null;
	}
}

const asClient = (c: FakeClient) => c as unknown as WebDavClient;
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (b: Uint8Array | null | undefined) => (b ? new TextDecoder().decode(b) : null);
const DELTA = 'cashier-xacts-dev1.000001.upd';
const LEGACY = 'cashier-xacts-dev2.ydoc';

async function configure(enabled: boolean, passphrase = 'secret') {
	await saveWebDavEncryption({ enabled, passphrase });
}

beforeEach(async () => {
	await db.deviceSettings.clear();
});

describe('settings', () => {
	it('are off by default, and kept on this device', async () => {
		expect(await loadWebDavEncryption()).toEqual({ enabled: false, passphrase: '' });
		await configure(true, 'pw');
		expect(await loadWebDavEncryption()).toEqual({ enabled: true, passphrase: 'pw' });
	});
});

describe('remoteFor', () => {
	it('is the plain folder while encryption is off', async () => {
		const dav = new FakeClient();
		const remote = await remoteFor(asClient(dav));

		await remote.put('crdt/xacts/dev1.000001.upd', bytes('hello'));
		expect(text(dav.files.get(DELTA))).toBe('hello');
	});

	it('starts an empty folder encrypted: key file, and nothing readable in the files', async () => {
		await configure(true);
		const dav = new FakeClient();
		const remote = await remoteFor(asClient(dav));

		await remote.put('crdt/xacts/dev1.000001.upd', bytes('hello'));
		expect(dav.files.has(KEY_FILE)).toBe(true);
		expect(text(dav.files.get(DELTA))).not.toContain('hello');
		expect(text(await remote.get('crdt/xacts/dev1.000001.upd'))).toBe('hello');
	});

	it('uses the key another device created, so both read each other', async () => {
		await configure(true);
		const dav = new FakeClient();
		const first = await remoteFor(asClient(dav));
		await first.put('crdt/xacts/dev1.000001.upd', bytes('from the first'));

		const second = await remoteFor(asClient(dav));
		expect(text(await second.get('crdt/xacts/dev1.000001.upd'))).toBe('from the first');
	});

	it('refuses when encryption is on but the folder already holds plain files', async () => {
		await configure(true);
		const dav = new FakeClient();
		dav.files.set(DELTA, bytes('plain'));

		await expect(remoteFor(asClient(dav))).rejects.toMatchObject({ mode: 'needs-encrypt' });
		await expect(remoteFor(asClient(dav))).rejects.toBeInstanceOf(EncryptionMismatchError);
	});

	it('refuses when the folder is encrypted but encryption is off', async () => {
		const dav = new FakeClient();
		dav.files.set(KEY_FILE, bytes(JSON.stringify((await createKeyParams('secret')).params)));

		await expect(remoteFor(asClient(dav))).rejects.toMatchObject({ mode: 'needs-decrypt' });
	});

	it('refuses a wrong passphrase', async () => {
		await configure(true, 'right');
		const dav = new FakeClient();
		await (await remoteFor(asClient(dav))).put('crdt/xacts/dev1.000001.upd', bytes('x'));
		await configure(true, 'wrong');

		await expect(remoteFor(asClient(dav))).rejects.toBeInstanceOf(WrongPassphraseError);
	});

	it('needs a passphrase', async () => {
		await configure(true, '');
		await expect(remoteFor(asClient(new FakeClient()))).rejects.toThrow(/passphrase/);
	});
});

describe('folder state', () => {
	it('tells whether the folder is encrypted and how many sync files it holds', async () => {
		const dav = new FakeClient();
		dav.files.set(DELTA, bytes('x'));
		dav.files.set('settings.json.gz', bytes('y'));
		expect(await webDavFolderState(asClient(dav))).toEqual({ encrypted: false, objects: 1 });

		dav.files.set(KEY_FILE, bytes(JSON.stringify((await createKeyParams('a')).params)));
		expect((await webDavFolderState(asClient(dav))).encrypted).toBe(true);
	});
});

describe('converting the folder', () => {
	it('encrypts every sync file and sets the key file, leaving the rest alone', async () => {
		const dav = new FakeClient();
		dav.files.set(DELTA, bytes('delta'));
		dav.files.set(LEGACY, bytes('legacy'));
		dav.files.set('settings.json.gz', bytes('settings'));
		const progress: string[] = [];

		const result = await convertWebDavFolder(asClient(dav), 'encrypt', 'secret', (d, t) =>
			progress.push(`${d}/${t}`)
		);

		expect(result).toEqual({ converted: 1, skipped: 1 });
		expect(progress).toEqual(['1/2']);
		expect(text(dav.files.get(DELTA))).not.toContain('delta');
		expect(text(dav.files.get(LEGACY))).toBe('legacy');
		expect(text(dav.files.get('settings.json.gz'))).toBe('settings');
		expect(dav.files.has(KEY_FILE)).toBe(true);

		// With the switch on, the folder now reads as it should.
		await configure(true);
		expect(text(await (await remoteFor(asClient(dav))).get('crdt/xacts/dev1.000001.upd'))).toBe(
			'delta'
		);
	});

	it('can be run again after an interruption', async () => {
		const dav = new FakeClient();
		dav.files.set(DELTA, bytes('one'));
		dav.files.set('cashier-xacts-dev1.000002.upd', bytes('two'));
		await convertWebDavFolder(asClient(dav), 'encrypt', 'secret');
		// An interrupted run left the second file plain.
		dav.files.set('cashier-xacts-dev1.000002.upd', bytes('two'));

		const result = await convertWebDavFolder(asClient(dav), 'encrypt', 'secret');
		expect(result.converted).toBe(1);
		await configure(true);
		const remote = await remoteFor(asClient(dav));
		expect(text(await remote.get('crdt/xacts/dev1.000001.upd'))).toBe('one');
		expect(text(await remote.get('crdt/xacts/dev1.000002.upd'))).toBe('two');
	});

	it('decrypts every sync file and removes the key file', async () => {
		const dav = new FakeClient();
		dav.files.set(DELTA, bytes('delta'));
		await convertWebDavFolder(asClient(dav), 'encrypt', 'secret');

		const result = await convertWebDavFolder(asClient(dav), 'decrypt', 'secret');

		expect(result.converted).toBe(1);
		expect(text(dav.files.get(DELTA))).toBe('delta');
		expect(dav.files.has(KEY_FILE)).toBe(false);
		expect(await webDavFolderState(asClient(dav))).toEqual({ encrypted: false, objects: 1 });
	});

	it('does not decrypt with a wrong passphrase, and changes nothing', async () => {
		const dav = new FakeClient();
		dav.files.set(DELTA, bytes('delta'));
		await convertWebDavFolder(asClient(dav), 'encrypt', 'secret');
		const sealed = dav.files.get(DELTA)!.slice();

		await expect(convertWebDavFolder(asClient(dav), 'decrypt', 'nope')).rejects.toBeInstanceOf(
			WrongPassphraseError
		);
		expect(Array.from(dav.files.get(DELTA)!)).toEqual(Array.from(sealed));
		expect(dav.files.has(KEY_FILE)).toBe(true);
	});

	it('has nothing to decrypt in a folder that is not encrypted', async () => {
		const dav = new FakeClient();
		dav.files.set(DELTA, bytes('delta'));

		expect(await convertWebDavFolder(asClient(dav), 'decrypt', 'secret')).toEqual({
			converted: 0,
			skipped: 0
		});
		expect(text(dav.files.get(DELTA))).toBe('delta');
	});
});

describe('EncryptedRemoteStore', () => {
	async function store() {
		const inner = new MemoryRemoteStore();
		const { key } = await createKeyParams('secret');
		return { inner, store: new EncryptedRemoteStore(inner, key) };
	}

	it('refuses an object copied over another name', async () => {
		const { inner, store: s } = await store();
		await s.put('crdt/xacts/dev1.000001.upd', bytes('first'));
		await s.put('crdt/xacts/dev1.000002.upd', bytes('second'));

		// An attacker with write access replays the first delta as the second.
		inner.objects.set(
			'crdt/xacts/dev1.000002.upd',
			inner.objects.get('crdt/xacts/dev1.000001.upd')!
		);
		await expect(s.get('crdt/xacts/dev1.000002.upd')).rejects.toThrow();
		expect(text(await s.get('crdt/xacts/dev1.000001.upd'))).toBe('first');
	});

	it('reads the legacy state files of the older versions as they are', async () => {
		const { inner, store: s } = await store();
		await inner.put('crdt/xacts/dev2.ydoc', bytes('legacy'));

		expect(text(await s.get('crdt/xacts/dev2.ydoc'))).toBe('legacy');
	});

	it('gives back null for a missing object, and lists as the inner store does', async () => {
		const { store: s } = await store();
		await s.put('crdt/xacts/a.ack', bytes('x'));

		expect(await s.get('crdt/xacts/missing.ack')).toBeNull();
		expect((await s.list('crdt/')).map((i) => i.key)).toEqual(['crdt/xacts/a.ack']);
	});

	it('works on top of the WebDAV adapter', async () => {
		const dav = new FakeClient();
		const { key } = await createKeyParams('secret');
		const s = new EncryptedRemoteStore(new WebDavRemoteStore(asClient(dav)), key);
		await s.put('crdt/scx/dev1.000001.upd', bytes('scheduled'));

		expect([...dav.files.keys()]).toEqual(['cashier-scx-dev1.000001.upd']);
		expect(text(await s.get('crdt/scx/dev1.000001.upd'))).toBe('scheduled');
	});
});
