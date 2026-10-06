/*
    S3 sync: the decision about each shared file, and the manifests it is based on.
*/
import { describe, expect, it } from 'vitest';
import {
	decide,
	isSafePath,
	latestRemote,
	TOMBSTONE,
	type Manifest
} from '$lib/services/s3SyncPlan';

describe('decide: upload', () => {
	it('is unchanged when both sides are equal', () => {
		expect(decide('upload', 'a', 'a', null).action).toBe('unchanged');
		expect(decide('upload', null, null, null).action).toBe('unchanged');
	});

	it('uploads a new file', () => {
		expect(decide('upload', 'a', null, null).action).toBe('upload');
	});

	it('uploads a local change when the bucket has not changed since the last sync', () => {
		expect(decide('upload', 'b', 'a', 'a').action).toBe('upload');
	});

	it('skips when only the bucket changed', () => {
		const d = decide('upload', 'a', 'b', 'a');
		expect(d.action).toBe('skip');
		expect(d.reason).toMatch(/download/i);
	});

	it('reports a conflict when both sides changed', () => {
		expect(decide('upload', 'b', 'c', 'a').action).toBe('conflict');
	});

	it('reports a conflict for different files that were never synced', () => {
		expect(decide('upload', 'b', 'c', null).action).toBe('conflict');
	});

	it('skips a file that was never synced to this device', () => {
		expect(decide('upload', null, 'a', null).action).toBe('skip');
	});
});

describe('decide: deletions', () => {
	it('proposes deleting from the bucket a file deleted here, unchanged in the bucket', () => {
		expect(decide('upload', null, 'a', 'a').action).toBe('delete-remote');
	});

	it('reports a conflict when the file was deleted here but changed in the bucket', () => {
		expect(decide('upload', null, 'b', 'a').action).toBe('conflict');
	});

	it('does nothing when the file is gone on both sides', () => {
		expect(decide('upload', null, TOMBSTONE, 'a').action).toBe('unchanged');
		expect(decide('download', null, TOMBSTONE, 'a').action).toBe('unchanged');
	});

	it('proposes deleting here a file deleted in the bucket, unchanged here', () => {
		expect(decide('download', 'a', TOMBSTONE, 'a').action).toBe('delete-local');
	});

	it('reports a conflict when the file changed here but was deleted in the bucket', () => {
		expect(decide('download', 'b', TOMBSTONE, 'a').action).toBe('conflict');
		expect(decide('upload', 'b', TOMBSTONE, 'a').action).toBe('conflict');
	});

	it('keeps a local file that was never synced, even if the bucket deleted that path before', () => {
		expect(decide('download', 'a', TOMBSTONE, null).action).toBe('skip');
		expect(decide('upload', 'a', TOMBSTONE, null).action).toBe('upload');
	});

	it('does not upload over a deletion it has not applied', () => {
		expect(decide('upload', 'a', TOMBSTONE, 'a').action).toBe('skip');
	});

	it('restores on download a file deleted only here', () => {
		expect(decide('download', null, 'a', 'a').action).toBe('download');
	});
});

describe('decide: download', () => {
	it('downloads a file this device does not have', () => {
		expect(decide('download', null, 'a', null).action).toBe('download');
	});

	it('downloads a remote change when this device has not changed since the last sync', () => {
		expect(decide('download', 'a', 'b', 'a').action).toBe('download');
	});

	it('skips when only this device changed', () => {
		const d = decide('download', 'b', 'a', 'a');
		expect(d.action).toBe('skip');
		expect(d.reason).toMatch(/upload/i);
	});

	it('reports a conflict when both sides changed', () => {
		expect(decide('download', 'b', 'c', 'a').action).toBe('conflict');
	});

	it('reports a conflict for different files that were never synced', () => {
		expect(decide('download', 'b', 'c', null).action).toBe('conflict');
	});

	it('skips a file that is not in the bucket', () => {
		expect(decide('download', 'a', null, 'a').action).toBe('skip');
	});
});

describe('latestRemote', () => {
	const manifest = (deviceId: string, files: Manifest['files']): Manifest => ({
		deviceId,
		updated: '',
		files
	});

	it('picks the newest entry per path across devices', () => {
		const latest = latestRemote([
			manifest('d1', {
				'a.bean': { hash: 'old', at: '2026-01-01T00:00:00Z' },
				'b.bean': { hash: 'b1', at: '2026-01-01T00:00:00Z' }
			}),
			manifest('d2', { 'a.bean': { hash: 'new', at: '2026-02-01T00:00:00Z' } })
		]);
		expect(latest.get('a.bean')?.hash).toBe('new');
		expect(latest.get('b.bean')?.hash).toBe('b1');
		expect(latest.size).toBe(2);
	});

	it('is empty without manifests', () => {
		expect(latestRemote([]).size).toBe(0);
	});
});

describe('isSafePath', () => {
	it('accepts ordinary relative paths', () => {
		expect(isSafePath('main.bean')).toBe(true);
		expect(isSafePath('2024/accounts.bean')).toBe(true);
	});

	it('rejects paths that escape or target the cache folder', () => {
		for (const p of ['', '/abs.bean', '../x.bean', 'a/../x.bean', 'a//b.bean', 'a\\b.bean']) {
			expect(isSafePath(p), p).toBe(false);
		}
		expect(isSafePath('.cashier/cache.bin')).toBe(false);
	});
});
