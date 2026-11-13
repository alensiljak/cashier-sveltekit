/*
	Sync hub tests — the cached channel state (SyncHub) and the pure staleness rules (channel.ts),
	with fake channels, so no network, services or storage are involved.
*/

import {
	DEFAULT_STALE_MS,
	emptySnapshot,
	isStale,
	newestSync,
	overallState,
	type ChannelSnapshot,
	type SyncChannel
} from '#lib/sync/channel';
import { SyncHub } from '#lib/sync/syncHub.svelte';
import { assert, describe, test } from 'vitest';

const NOW = new Date('2026-11-13T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const snap = (over: Partial<ChannelSnapshot>): ChannelSnapshot => ({ ...emptySnapshot(), ...over });

describe('isStale', () => {
	test('unknown is stale', () => assert.isTrue(isStale(null, NOW)));
	test('within the limit is fresh', () => assert.isFalse(isStale(daysAgo(6), NOW)));
	test('beyond the limit is stale', () => assert.isTrue(isStale(daysAgo(8), NOW)));
	test('the limit is configurable', () => assert.isTrue(isStale(daysAgo(2), NOW, 86_400_000)));
	test('the default is a week', () => assert.equal(DEFAULT_STALE_MS, 7 * 86_400_000));
});

describe('overallState', () => {
	test('no channels', () => assert.equal(overallState([], NOW), 'none'));

	test('an error outranks everything', () => {
		assert.equal(
			overallState([snap({ status: 'differs' }), snap({ status: 'error' })], NOW),
			'error'
		);
	});

	test('changes to exchange need attention', () => {
		assert.equal(
			overallState([snap({ status: 'same' }), snap({ status: 'differs' })], NOW),
			'attention'
		);
	});

	test('confirmed in sync, or synced recently, is ok', () => {
		assert.equal(overallState([snap({ status: 'same' })], NOW), 'ok');
		assert.equal(overallState([snap({ lastSync: daysAgo(1) })], NOW), 'ok');
	});

	test('one fresh channel is enough', () => {
		assert.equal(
			overallState([snap({ lastSync: daysAgo(30) }), snap({ lastSync: daysAgo(1) })], NOW),
			'ok'
		);
	});

	test('nothing confirmed and nothing recent is stale', () => {
		assert.equal(overallState([snap({})], NOW), 'stale');
		assert.equal(overallState([snap({ lastSync: daysAgo(30) })], NOW), 'stale');
	});
});

test('newestSync', () => {
	assert.isNull(newestSync([snap({})]));
	assert.equal(
		newestSync([
			snap({ lastSync: daysAgo(3) }),
			snap({ lastSync: daysAgo(1) }),
			snap({})
		])?.getTime(),
		daysAgo(1).getTime()
	);
});

// ─── SyncHub ─────────────────────────────────────────────────────────────────

interface FakeOpts {
	enabled?: boolean;
	unavailable?: string | null;
	check?: () => Promise<'same' | 'differs'>;
	sync?: () => Promise<{ errors: string[]; merged: boolean }>;
	lastSync?: () => Promise<Date | null>;
}

function fake(id: SyncChannel['id'], o: FakeOpts = {}): SyncChannel & { calls: string[] } {
	const calls: string[] = [];
	return {
		id,
		label: id,
		href: `/${id}`,
		calls,
		isEnabled: () => o.enabled ?? true,
		unavailableReason: () => o.unavailable ?? null,
		check: async () => {
			calls.push('check');
			return (o.check ?? (async () => 'same' as const))();
		},
		sync: async () => {
			calls.push('sync');
			return (o.sync ?? (async () => ({ errors: [], merged: false })))();
		},
		lastSync: o.lastSync
	};
}

function hub(channels: SyncChannel[], stored: Record<string, string> = {}) {
	const saved: Record<string, string>[] = [];
	let merged = 0;
	const h = new SyncHub(channels, {
		now: () => NOW,
		store: {
			load: async () => ({ ...stored, ...saved.at(-1) }),
			save: async (m) => void saved.push(m)
		},
		onMerged: async () => void merged++
	});
	return { h, saved, merged: () => merged };
}

describe('SyncHub', () => {
	test('starts unchecked and contacts nothing until asked', async () => {
		const a = fake('webdav');
		const { h } = hub([a]);
		await h.load();
		assert.equal(h.snapshotOf('webdav').status, 'unchecked');
		assert.deepEqual(a.calls, []);
	});

	test("load reads stored last-sync times, preferring the channel's own", async () => {
		const own = daysAgo(1);
		const { h } = hub([fake('webdav'), fake('s3', { lastSync: async () => own })], {
			webdav: daysAgo(2).toISOString(),
			s3: daysAgo(5).toISOString()
		});
		await h.load();
		assert.equal(h.snapshotOf('webdav').lastSync?.getTime(), daysAgo(2).getTime());
		assert.equal(h.snapshotOf('s3').lastSync?.getTime(), own.getTime());
		assert.isTrue(h.loaded);
	});

	test('only enabled channels count', () => {
		const { h } = hub([fake('webdav', { enabled: false }), fake('s3')]);
		assert.deepEqual(
			h.enabled.map((c) => c.id),
			['s3']
		);
	});

	test('check records the result and when', async () => {
		const { h } = hub([fake('s3', { check: async () => 'differs' })]);
		const s = await h.check('s3');
		assert.equal(s.status, 'differs');
		assert.equal(s.checkedAt?.getTime(), NOW.getTime());
	});

	test('a failed check is an error with its message', async () => {
		const { h } = hub([
			fake('s3', {
				check: async () => {
					throw new Error('bucket unreachable');
				}
			})
		]);
		const s = await h.check('s3');
		assert.equal(s.status, 'error');
		assert.equal(s.error, 'bucket unreachable');
	});

	test('an unavailable channel is not contacted', async () => {
		const p = fake('peer', { unavailable: 'Peer sync is off' });
		const { h } = hub([p]);
		const s = await h.check('peer');
		assert.equal(s.status, 'error');
		assert.equal(s.error, 'Peer sync is off');
		assert.deepEqual(p.calls, []);
	});

	test('checkAll skips disabled and unavailable channels', async () => {
		const on = fake('webdav');
		const off = fake('s3', { enabled: false });
		const down = fake('peer', { unavailable: 'x' });
		const { h } = hub([on, off, down]);
		await h.checkAll();
		assert.deepEqual(on.calls, ['check']);
		assert.deepEqual(off.calls, []);
		assert.deepEqual(down.calls, []);
	});

	test('a successful sync marks the channel in sync and stores the time', async () => {
		const { h, saved, merged } = hub([fake('webdav')]);
		const r = await h.sync('webdav');
		assert.deepEqual(r, { ok: true, merged: false, errors: [] });
		const s = h.snapshotOf('webdav');
		assert.equal(s.status, 'same');
		assert.equal(s.lastSync?.getTime(), NOW.getTime());
		assert.isFalse(s.busy);
		assert.deepEqual(saved, [{ webdav: NOW.toISOString() }]);
		assert.equal(merged(), 0);
	});

	test('a sync that merged records reloads the ledger', async () => {
		const { h, merged } = hub([fake('s3', { sync: async () => ({ errors: [], merged: true }) })]);
		const r = await h.sync('s3');
		assert.isTrue(r.merged);
		assert.equal(merged(), 1);
	});

	test('per-item errors fail the sync and do not store a time', async () => {
		const { h, saved } = hub([
			fake('s3', { sync: async () => ({ errors: ['one', 'two'], merged: false }) })
		]);
		const r = await h.sync('s3');
		assert.isFalse(r.ok);
		assert.deepEqual(r.errors, ['one', 'two']);
		assert.equal(h.snapshotOf('s3').status, 'error');
		assert.equal(h.snapshotOf('s3').error, 'one; two');
		assert.isNull(h.snapshotOf('s3').lastSync);
		assert.deepEqual(saved, []);
	});

	test('a thrown sync is reported and leaves the channel not busy', async () => {
		const { h } = hub([
			fake('webdav', {
				sync: async () => {
					throw new Error('offline');
				}
			})
		]);
		const r = await h.sync('webdav');
		assert.deepEqual(r, { ok: false, merged: false, errors: ['offline'] });
		assert.isFalse(h.snapshotOf('webdav').busy);
	});

	test('a second sync while one runs is refused', async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const c = fake('s3', {
			sync: async () => {
				await gate;
				return { errors: [], merged: false };
			}
		});
		const { h } = hub([c]);
		const first = h.sync('s3');
		const second = await h.sync('s3');
		assert.isFalse(second.ok);
		assert.deepEqual(c.calls, ['sync']);
		release();
		assert.isTrue((await first).ok);
	});

	test('overall reflects the enabled channels', async () => {
		const { h } = hub([
			fake('webdav', { check: async () => 'differs' }),
			fake('s3', { enabled: false })
		]);
		assert.equal(h.overall, 'stale');
		await h.check('webdav');
		assert.equal(h.overall, 'attention');
	});

	test('an unknown channel id is an error', async () => {
		const { h } = hub([fake('s3')]);
		let message = '';
		try {
			await h.check('webdav');
		} catch (e) {
			message = (e as Error).message;
		}
		assert.match(message, /Unknown sync channel/);
	});
});
