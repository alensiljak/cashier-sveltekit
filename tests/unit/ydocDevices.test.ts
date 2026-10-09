/*
    Per-device Yjs state files on WebDAV: the working set and the scheduled
    transactions are separate files per device, each with its own merge state.
*/
import { describe, expect, it } from 'vitest';
import {
	needsMerge,
	parseYdocFilename,
	ydocFilename,
	type MergeState,
	type RemoteDevice
} from '#lib/sync/ydocDevices';

const device = (over: Partial<RemoteDevice> = {}): RemoteDevice => ({
	deviceId: 'dev1',
	filename: 'cashier-xacts-dev1.ydoc',
	size: 10,
	lastModified: new Date('2026-01-02T00:00:00Z'),
	status: 'trusted',
	...over
});

describe('file names', () => {
	it('builds and parses a name per kind', () => {
		expect(ydocFilename('dev1')).toBe('cashier-xacts-dev1.ydoc');
		expect(ydocFilename('dev1', 'scx')).toBe('cashier-scx-dev1.ydoc');
		expect(parseYdocFilename('cashier-xacts-dev1.ydoc')).toBe('dev1');
		expect(parseYdocFilename('cashier-scx-dev1.ydoc', 'scx')).toBe('dev1');
	});

	it('does not mistake one kind for the other', () => {
		expect(parseYdocFilename('cashier-scx-dev1.ydoc')).toBeNull();
		expect(parseYdocFilename('cashier-xacts-dev1.ydoc', 'scx')).toBeNull();
		expect(parseYdocFilename('settings.json')).toBeNull();
	});
});

describe('needsMerge', () => {
	const merged: MergeState = {
		remoteTs: '2026-01-02T00:00:00.000Z',
		mergedAt: '2026-01-03T00:00:00.000Z'
	};

	it('working set: never merged, or changed since', () => {
		expect(needsMerge(device(), undefined)).toBe(true);
		expect(needsMerge(device(), merged)).toBe(false);
		expect(needsMerge(device({ lastModified: new Date('2026-01-05T00:00:00Z') }), merged)).toBe(
			true
		);
	});

	it('scheduled transactions: nothing to merge without a file', () => {
		expect(needsMerge(device(), undefined, 'scx')).toBe(false);
	});

	it('scheduled transactions: never merged, or changed since', () => {
		const withScx = device({
			scx: { filename: 'cashier-scx-dev1.ydoc', lastModified: new Date('2026-01-02T00:00:00Z') }
		});

		// A state from before scheduled transactions were synced has no scx timestamp.
		expect(needsMerge(withScx, merged, 'scx')).toBe(true);
		expect(needsMerge(withScx, { ...merged, scxTs: '2026-01-02T00:00:00.000Z' }, 'scx')).toBe(
			false
		);
		expect(needsMerge(withScx, { ...merged, scxTs: '2026-01-01T00:00:00.000Z' }, 'scx')).toBe(true);
	});

	it('the two kinds are tracked independently', () => {
		const withScx = device({
			scx: { filename: 'cashier-scx-dev1.ydoc', lastModified: new Date('2026-01-02T00:00:00Z') }
		});
		const state: MergeState = { ...merged, scxTs: '2026-01-01T00:00:00.000Z' };

		expect(needsMerge(withScx, state)).toBe(false);
		expect(needsMerge(withScx, state, 'scx')).toBe(true);
	});
});
