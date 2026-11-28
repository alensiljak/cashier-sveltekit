/*
    The database upgrade that made one `proxy` setting of the proxy URL and key.
*/
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

describe('proxy settings upgrade', () => {
	it('makes one setting of the URL and the key', async () => {
		// The database as version 10 left it.
		const old = new Dexie('Cashier');
		old.version(10).stores({ settings: 'key', deviceSettings: 'key' });
		await old.table('deviceSettings').bulkAdd([
			{ key: 'proxy.url', value: '"https://proxy.example.com/api/proxy"' },
			{ key: 'proxy.key', value: '"proxy-key"' },
			{ key: 'peerName', value: '"Phone"' }
		]);
		old.close();

		const { default: db } = await import('#lib/data/db');
		const rows = (await db.deviceSettings.toArray()) as { key: string; value: string }[];

		expect(rows.map((r) => r.key)).toEqual(['peerName', 'proxy']);
		expect(JSON.parse(rows[1].value)).toEqual({
			url: 'https://proxy.example.com/api/proxy',
			key: 'proxy-key'
		});
	});
});
