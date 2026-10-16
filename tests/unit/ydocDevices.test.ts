/*
    Device identity and the Trusted Devices list, shared by Peer Sync, WebDAV and S3.
*/
import { describe, expect, it } from 'vitest';
import db from '#lib/data/db';
import { getDeviceId, trustDevice } from '#lib/sync/ydocDevices';

describe('getDeviceId', () => {
	it('is created once and then stays the same', async () => {
		const id = await getDeviceId();

		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		expect(await getDeviceId()).toBe(id);
	});
});

describe('trustDevice', () => {
	it('adds the device with the given name, trimmed', async () => {
		const tp = await trustDevice('dev-trust-1', '  Phone  ');

		expect(tp.name).toBe('Phone');
		expect((await db.peers.get('dev-trust-1'))?.name).toBe('Phone');
	});

	it('names an unnamed device after the start of its ID', async () => {
		const tp = await trustDevice('abcdef123456', '  ');

		expect(tp.name).toBe('Device abcdef');
	});
});
