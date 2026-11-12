/*
    Introductions: signed proposals from a trusted device that the receiving device queues.
*/
import { describe, expect, it } from 'vitest';
import { PendingIntroduction, TrustedPeer } from '#lib/data/model';
import { deviceIdFromPublicKey, generateDeviceKey, type DeviceKey } from '#lib/sync/deviceKey';
import {
	introductionsFor,
	receiveIntroductions,
	signIntroduction,
	verifyIntroduction
} from '#lib/sync/introductions';

function peer(id: string, name: string, key: DeviceKey | null, extra: Partial<TrustedPeer> = {}) {
	const tp = new TrustedPeer();
	Object.assign(tp, { id, name, publicKey: key?.publicKey, ...extra });
	return tp;
}

async function setup() {
	const [a, c, me, d] = await Promise.all([
		generateDeviceKey(),
		generateDeviceKey(),
		generateDeviceKey(),
		generateDeviceKey()
	]);
	return {
		a,
		c,
		me,
		d,
		aRecord: peer('a-uuid', 'Laptop', a)
	};
}

const subjectOf = (id: string, name: string, key: DeviceKey) => ({
	id,
	name,
	publicKey: key.publicKey
});

describe('introduction signatures', () => {
	it('verify for the introducer and for nobody else, and break when any field changes', async () => {
		const { a, c } = await setup();
		const intro = await signIntroduction(a, 'a-uuid', subjectOf('c-uuid', 'Phone', c), 1000);

		expect(await verifyIntroduction(intro, a.publicKey)).toBe(true);
		expect(await verifyIntroduction(intro, c.publicKey)).toBe(false);
		expect(await verifyIntroduction({ ...intro, at: 1001 }, a.publicKey)).toBe(false);
		expect(await verifyIntroduction({ ...intro, by: 'x' }, a.publicKey)).toBe(false);
		expect(
			await verifyIntroduction(
				{ ...intro, subject: { ...intro.subject, name: 'Other' } },
				a.publicKey
			)
		).toBe(false);
		expect(
			await verifyIntroduction({ ...intro, subject: { ...intro.subject, id: 'z' } }, a.publicKey)
		).toBe(false);
	});
});

describe('what a device offers', () => {
	it('introduces every other trusted device that has a key, under the name it announced', async () => {
		const { a, c, d } = await setup();
		const trusted = [
			peer('c-uuid', 'My C', c, { announcedName: "Anna's phone" }),
			peer('d-uuid', 'Tablet', d),
			peer('old-uuid', 'Legacy', null)
		];

		const intros = await introductionsFor('d-uuid', { id: 'a-uuid', key: a }, trusted, 5);

		expect(intros.map((i) => i.subject.id)).toEqual(['c-uuid']);
		expect(intros[0].subject.name).toBe("Anna's phone");
		expect(intros[0].by).toBe('a-uuid');
		expect(await verifyIntroduction(intros[0], a.publicKey)).toBe(true);
	});
});

describe('what a device takes from an introduction', () => {
	async function receive(
		raw: unknown,
		options: {
			introducer?: TrustedPeer;
			trusted?: TrustedPeer[];
			pending?: PendingIntroduction[];
			meKey?: DeviceKey;
		} = {}
	) {
		const s = await setup();
		const introducer = options.introducer ?? s.aRecord;
		return receiveIntroductions(raw, {
			me: { id: 'me-uuid', publicKey: (options.meKey ?? s.me).publicKey },
			introducer,
			trusted: options.trusted ?? [introducer],
			pending: options.pending ?? []
		});
	}

	it('queues a request for a device a trusted, non-read-only device vouches for', async () => {
		const { a, c, aRecord } = await setup();
		const intro = await signIntroduction(a, 'a-uuid', subjectOf('c-uuid', 'Phone', c), 7);

		const [request, ...rest] = await receiveIntroductions([intro], {
			me: { id: 'me-uuid', publicKey: 'me-key' },
			introducer: aRecord,
			trusted: [aRecord],
			pending: [],
			now: 0
		});

		expect(rest).toEqual([]);
		expect(request).toMatchObject({
			id: await deviceIdFromPublicKey(c.publicKey),
			subjectId: 'c-uuid',
			name: 'Phone',
			publicKey: c.publicKey,
			status: 'pending',
			introducedBy: [{ id: 'a-uuid', name: 'Laptop', at: 7 }]
		});
		expect(request.fingerprint).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
	});

	it('trusts nothing by itself: it only returns requests', async () => {
		const { a, c, aRecord } = await setup();
		const trusted = [aRecord];
		const intro = await signIntroduction(a, 'a-uuid', subjectOf('c-uuid', 'Phone', c));

		await receiveIntroductions([intro], {
			me: { id: 'me-uuid', publicKey: 'x' },
			introducer: aRecord,
			trusted,
			pending: []
		});

		expect(trusted).toEqual([aRecord]);
	});

	it('refuses an introducer that is read-only or has no key', async () => {
		const { a, c } = await setup();
		const intro = await signIntroduction(a, 'a-uuid', subjectOf('c-uuid', 'Phone', c));

		expect(
			await receive([intro], { introducer: peer('a-uuid', 'L', a, { readOnly: true }) })
		).toEqual([]);
		expect(await receive([intro], { introducer: peer('a-uuid', 'L', null) })).toEqual([]);
	});

	it('refuses an introduction signed by someone else, or naming another introducer', async () => {
		const { a, c, d, aRecord } = await setup();
		const forged = await signIntroduction(d, 'a-uuid', subjectOf('c-uuid', 'Phone', c));
		const other = await signIntroduction(a, 'b-uuid', subjectOf('c-uuid', 'Phone', c));
		const tampered = {
			...(await signIntroduction(a, 'a-uuid', subjectOf('c-uuid', 'Phone', c))),
			subject: subjectOf('c-uuid', 'Boss', c)
		};

		expect(await receive([forged], { introducer: aRecord })).toEqual([]);
		expect(await receive([other], { introducer: aRecord })).toEqual([]);
		expect(await receive([tampered], { introducer: aRecord })).toEqual([]);
	});

	it('refuses malformed input, and too many introductions at once', async () => {
		const { a, c, aRecord } = await setup();
		const good = await signIntroduction(a, 'a-uuid', subjectOf('c-uuid', 'Phone', c));

		for (const raw of [
			null,
			'x',
			{},
			[null],
			[{ ...good, v: 2 }],
			[{ ...good, at: 'now' }],
			[{ ...good, subject: null }],
			[{ ...good, subject: { ...good.subject, name: 'x'.repeat(101) } }],
			Array(51).fill(good)
		]) {
			expect(await receive(raw, { introducer: aRecord })).toEqual([]);
		}
	});

	it('ignores this device, devices it already trusts and a key claiming a trusted ID', async () => {
		const { a, c, d, me, aRecord } = await setup();
		const ofMe = await signIntroduction(a, 'a-uuid', subjectOf('me-uuid', 'Me', me));
		const ofMeUnderOtherId = await signIntroduction(a, 'a-uuid', subjectOf('zz', 'Me', me));
		const ofC = await signIntroduction(a, 'a-uuid', subjectOf('c-uuid', 'Phone', c));
		const ofCUnderOtherId = await signIntroduction(a, 'a-uuid', subjectOf('c2-uuid', 'Phone', c));
		const ofD = await signIntroduction(a, 'a-uuid', subjectOf('c-uuid', 'Phone', d));
		const trustedC = peer('c-uuid', 'Phone', c);

		expect(await receive([ofMe, ofMeUnderOtherId], { introducer: aRecord, meKey: me })).toEqual([]);
		expect(await receive([ofC, ofCUnderOtherId], { trusted: [aRecord, trustedC] })).toEqual([]);
		// `d` claims the ID of the trusted device `c`: it can't take that place.
		expect(await receive([ofD], { trusted: [aRecord, trustedC] })).toEqual([]);
	});

	it('adds a second introducer to the same request, and does not repeat one it has', async () => {
		const { a, c, d, aRecord } = await setup();
		const dRecord = peer('d-uuid', 'Tablet', d);
		const fromA = await signIntroduction(a, 'a-uuid', subjectOf('c-uuid', 'Phone', c), 1);
		const fromD = await signIntroduction(d, 'd-uuid', subjectOf('c-uuid', 'Phone', c), 2);
		const trusted = [aRecord, dRecord];

		const [first] = await receiveIntroductions([fromA], {
			me: { id: 'me-uuid', publicKey: 'x' },
			introducer: aRecord,
			trusted,
			pending: []
		});
		const [second] = await receiveIntroductions([fromD], {
			me: { id: 'me-uuid', publicKey: 'x' },
			introducer: dRecord,
			trusted,
			pending: [first]
		});
		const again = await receiveIntroductions([fromA], {
			me: { id: 'me-uuid', publicKey: 'x' },
			introducer: aRecord,
			trusted,
			pending: [second]
		});

		expect(second.introducedBy.map((b) => b.id)).toEqual(['a-uuid', 'd-uuid']);
		expect(again).toEqual([]);
	});

	it('keeps a dismissed request dismissed when it is offered again', async () => {
		const { a, c, d, aRecord } = await setup();
		const dRecord = peer('d-uuid', 'Tablet', d);
		const fromA = await signIntroduction(a, 'a-uuid', subjectOf('c-uuid', 'Phone', c));
		const fromD = await signIntroduction(d, 'd-uuid', subjectOf('c-uuid', 'Phone', c));
		const [first] = await receiveIntroductions([fromA], {
			me: { id: 'me-uuid', publicKey: 'x' },
			introducer: aRecord,
			trusted: [aRecord, dRecord],
			pending: []
		});
		first.status = 'dismissed';

		const [again] = await receiveIntroductions([fromD], {
			me: { id: 'me-uuid', publicKey: 'x' },
			introducer: dRecord,
			trusted: [aRecord, dRecord],
			pending: [first]
		});

		expect(again.status).toBe('dismissed');
	});
});
