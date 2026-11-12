/*
    Invite links and the sync group secret.
*/
import { beforeEach, describe, expect, it } from 'vitest';
import db from '#lib/data/db';
import { toBase64Url } from '#lib/sync/encoding';
import {
	INVITE_TTL_MS,
	createInvitePayload,
	deriveInvitePassword,
	deriveInviteRoom,
	encodeInvite,
	inviteLink,
	parseInvite
} from '#lib/sync/invite';
import {
	deriveSyncPassword,
	deriveSyncRoom,
	ensureGroupSecret,
	generateGroupSecret,
	getGroupSecret,
	isValidGroupSecret,
	setGroupSecret
} from '#lib/sync/syncGroup';

const FP = '7kq2m9xa4bc0de1fgh2jk3mnp4';
const NOW = 1_700_000_000_000;

function payload() {
	return createInvitePayload({ name: "Anna's phone", fingerprint: FP, strategy: 'nostr' }, NOW);
}

describe('invite links', () => {
	it('round-trips through a link, a fragment and the bare token', () => {
		const p = payload();
		const token = encodeInvite(p);

		for (const text of [
			inviteLink('https://cashier.example', p),
			`#${token}`,
			token,
			`  https://cashier.example/pair#${token}\n`
		]) {
			expect(parseInvite(text, NOW)).toEqual({ ok: true, payload: p });
		}
	});

	it('keeps the payload in the fragment, which is never sent to a server', () => {
		const link = inviteLink('https://cashier.example', payload());

		expect(new URL(link).search).toBe('');
		expect(new URL(link).pathname).toBe('/pair');
		expect(new URL(link).hash.length).toBeGreaterThan(20);
	});

	it('expires after ten minutes', () => {
		const p = payload();

		expect(p.exp).toBe(NOW + INVITE_TTL_MS);
		expect(parseInvite(encodeInvite(p), p.exp - 1).ok).toBe(true);
		expect(parseInvite(encodeInvite(p), p.exp)).toEqual({ ok: false, reason: 'expired' });
	});

	it('gives every invite its own seed', () => {
		expect(payload().seed).not.toBe(payload().seed);
	});

	it('refuses what is not an invite', () => {
		const good = JSON.parse(JSON.stringify(payload()));
		const enc = (o: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(o)));

		for (const text of [
			'',
			'#',
			'not an invite',
			'https://cashier.example/pair',
			'https://cashier.example/pair#%%%',
			enc('a string'),
			enc(null),
			enc({ ...good, name: 5 }),
			enc({ ...good, fingerprint: 'short' }),
			enc({ ...good, fingerprint: FP.toUpperCase() }),
			enc({ ...good, strategy: 'carrier-pigeon' }),
			enc({ ...good, seed: 'AAAA' }),
			enc({ ...good, seed: 5 }),
			enc({ ...good, exp: 'soon' }),
			enc({ ...good, exp: null }),
			enc({ ...good, name: 'x'.repeat(101) }),
			'a'.repeat(3000)
		]) {
			expect(parseInvite(text, NOW), text.slice(0, 30)).toMatchObject({ ok: false });
		}
	});

	it('refuses a version it does not know', () => {
		const good = JSON.parse(JSON.stringify(payload()));
		const enc = (o: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(o)));

		expect(parseInvite(enc({ ...good, v: 2 }), NOW)).toEqual({ ok: false, reason: 'unsupported' });
	});

	it('drops fields it does not know', () => {
		const good = JSON.parse(JSON.stringify(payload()));
		const token = toBase64Url(new TextEncoder().encode(JSON.stringify({ ...good, extra: 'x' })));

		const result = parseInvite(token, NOW);

		expect(result.ok && 'extra' in result.payload).toBe(false);
	});
});

describe('invite room', () => {
	it('is derived from the seed, so the relay never sees the seed', async () => {
		const a = payload();
		const b = payload();

		expect(await deriveInviteRoom(a.seed)).toBe(await deriveInviteRoom(a.seed));
		expect(await deriveInviteRoom(a.seed)).not.toBe(await deriveInviteRoom(b.seed));
		expect(await deriveInviteRoom(a.seed)).not.toContain(a.seed);
		expect(await deriveInvitePassword(a.seed)).not.toBe(await deriveInviteRoom(a.seed));
	});
});

describe('sync group', () => {
	beforeEach(async () => {
		await db.deviceSettings.clear();
	});

	it('makes 32 random bytes, and validates only such a secret', () => {
		const secret = generateGroupSecret();

		expect(isValidGroupSecret(secret)).toBe(true);
		expect(generateGroupSecret()).not.toBe(secret);
		for (const bad of [
			'',
			'abc',
			5,
			null,
			undefined,
			secret.slice(1),
			secret + 'A',
			'A'.repeat(44)
		]) {
			expect(isValidGroupSecret(bad)).toBe(false);
		}
	});

	it('derives the same room and password on every device, and different ones per secret', async () => {
		const a = generateGroupSecret();
		const b = generateGroupSecret();

		expect(await deriveSyncRoom(a)).toBe(await deriveSyncRoom(a));
		expect(await deriveSyncRoom(a)).not.toBe(await deriveSyncRoom(b));
		expect(await deriveSyncPassword(a)).toBe(await deriveSyncPassword(a));
		expect(await deriveSyncPassword(a)).not.toBe(await deriveSyncPassword(b));
		expect(await deriveSyncRoom(a)).not.toContain(a);
		expect(await deriveSyncPassword(a)).not.toBe(await deriveSyncRoom(a));
	});

	it('is created once on first use and then stays', async () => {
		expect(await getGroupSecret()).toBeNull();

		const [x, y] = await Promise.all([ensureGroupSecret(), ensureGroupSecret()]);

		expect(x).toBe(y);
		expect(await ensureGroupSecret()).toBe(x);
		expect(await getGroupSecret()).toBe(x);
	});

	it('can be replaced by the secret of the group being joined, but not by garbage', async () => {
		const first = await ensureGroupSecret();
		const other = generateGroupSecret();

		await setGroupSecret(other);

		expect(await getGroupSecret()).toBe(other);
		expect(other).not.toBe(first);
		await expect(setGroupSecret('nope')).rejects.toThrow('valid');
		expect(await getGroupSecret()).toBe(other);
	});
});
