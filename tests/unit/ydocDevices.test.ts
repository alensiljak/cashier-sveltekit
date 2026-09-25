import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
	needsMerge,
	parseYdocFilename,
	ydocFilename,
	type RemoteDevice
} from '../../src/lib/sync/ydocDevices';
import { toRecord, fromRecord } from '../../src/lib/storage/crdtXactRecord';
import { Xact } from '../../src/lib/data/model';

function device(lastModified: Date | null): RemoteDevice {
	return {
		deviceId: 'abc',
		filename: ydocFilename('abc'),
		size: 1,
		lastModified,
		status: 'trusted'
	};
}

describe('ydoc file names', () => {
	it('round-trips a device id', () => {
		expect(parseYdocFilename(ydocFilename('1234-abcd'))).toBe('1234-abcd');
	});

	it('ignores unrelated files', () => {
		expect(parseYdocFilename('cashier.bean')).toBeNull();
		expect(parseYdocFilename('cashier-xacts-.ydoc')).toBeNull();
		expect(parseYdocFilename('cashier-xacts-abc.ydoc.bak')).toBeNull();
	});
});

describe('needsMerge', () => {
	const ts = new Date('2026-09-25T10:00:00Z');

	it('is true when never merged', () => {
		expect(needsMerge(device(ts), undefined)).toBe(true);
	});

	it('is false when the remote timestamp is unchanged', () => {
		expect(needsMerge(device(ts), { remoteTs: ts.toISOString(), mergedAt: 'x' })).toBe(false);
	});

	it('is true when the remote file changed', () => {
		const later = new Date('2026-09-25T11:00:00Z');
		expect(needsMerge(device(later), { remoteTs: ts.toISOString(), mergedAt: 'x' })).toBe(true);
	});
});

describe('record origin', () => {
	it('is stored on the record and dropped when read back as an Xact', () => {
		const record = toRecord(new Xact(), 'id1', 'device-a');
		expect(record.origin).toBe('device-a');
		expect(fromRecord(record)).not.toHaveProperty('origin');
	});

	it('is omitted when not given', () => {
		expect(toRecord(new Xact(), 'id1')).not.toHaveProperty('origin');
	});
});
