/*
	s3StatusView tests — pure display logic of the S3 sync page. See src/lib/services/s3StatusView.ts.
*/

import {
	actionsFor,
	badgeFor,
	describeItem,
	gapsFor,
	hasNewerRemote,
	isCleanRun,
	touchesLedger,
	type CompareStatus
} from '#lib/services/s3StatusView';
import type { SyncLine } from '#lib/services/s3Session';
import { assert, describe, test } from 'vitest';

const files = (
	settings: Partial<Record<'upload' | 'download' | 'conflict', number>> = {},
	beancount: Partial<Record<'upload' | 'download' | 'conflict', number>> = {}
): CompareStatus => ({
	fileStatus: {
		settings: { upload: 0, download: 0, conflict: 0, ...settings },
		beancount: { upload: 0, download: 0, conflict: 0, ...beancount }
	},
	crdtStatus: null
});

const crdt = (xacts: {
	upload?: boolean;
	download?: boolean;
	gaps?: unknown[];
}): CompareStatus => ({
	fileStatus: null,
	crdtStatus: {
		xacts: { upload: false, download: false, gaps: [], ...xacts } as never,
		scheduled: { upload: false, download: false, gaps: [] }
	}
});

const unknown: CompareStatus = { fileStatus: null, crdtStatus: null };

const line = (item: SyncLine['item'], outcome: SyncLine['outcome']): SyncLine => ({
	item,
	path: 'p',
	outcome
});

describe('hasNewerRemote', () => {
	test('files: a pending download or a conflict means newer data in the bucket', () => {
		assert.isTrue(hasNewerRemote(files({ download: 1 }), 'settings'));
		assert.isTrue(hasNewerRemote(files({}, { conflict: 2 }), 'beancount'));
		assert.isFalse(hasNewerRemote(files({ upload: 3 }), 'settings'));
	});

	test('CRDT stores and unknown status never ask for confirmation', () => {
		assert.isFalse(hasNewerRemote(crdt({ download: true }), 'xacts'));
		assert.isFalse(hasNewerRemote(unknown, 'settings'));
	});
});

describe('actionsFor', () => {
	test('all false while unknown', () => {
		assert.deepEqual(actionsFor(unknown, 'beancount'), { up: false, down: false, conflict: false });
		assert.deepEqual(actionsFor(unknown, 'xacts'), { up: false, down: false, conflict: false });
	});

	test('files report conflicts; CRDT stores do not', () => {
		assert.deepEqual(actionsFor(files({ upload: 1, conflict: 1 }), 'settings'), {
			up: true,
			down: false,
			conflict: true
		});
		assert.deepEqual(actionsFor(crdt({ upload: true, download: true }), 'xacts'), {
			up: true,
			down: true,
			conflict: false
		});
	});
});

describe('gapsFor', () => {
	test('only CRDT rows have gaps', () => {
		const gap = { deviceId: 'd', expected: 3, found: 5 };
		assert.deepEqual(gapsFor(crdt({ gaps: [gap] }), 'xacts'), [gap]);
		assert.deepEqual(gapsFor(files(), 'settings'), []);
		assert.deepEqual(gapsFor(unknown, 'scheduled'), []);
	});
});

describe('badgeFor', () => {
	test('null while unknown', () => {
		assert.isNull(badgeFor(unknown, 'settings'));
		assert.isNull(badgeFor(unknown, 'xacts'));
	});

	test('conflict wins over upload and download', () => {
		const b = badgeFor(files({}, { conflict: 2, upload: 1, download: 1 }), 'beancount')!;
		assert.equal(b.text, 'Conflict (2)');
		assert.equal(b.cls, 'badge-error');
		assert.deepEqual(b.kinds, ['conflict']);
	});

	test('counts are shown for Beancount files only', () => {
		assert.equal(badgeFor(files({}, { upload: 3 }), 'beancount')!.text, 'Upload needed (3)');
		assert.equal(badgeFor(files({ upload: 1 }), 'settings')!.text, 'Upload needed');
		assert.equal(
			badgeFor(files({}, { upload: 2, download: 4 }), 'beancount')!.text,
			'Upload (2) / Download (4)'
		);
		assert.equal(badgeFor(files({}, { download: 1 }), 'beancount')!.text, 'Download available (1)');
	});

	test('in sync when nothing is pending', () => {
		const b = badgeFor(files(), 'settings')!;
		assert.equal(b.text, 'In sync');
		assert.deepEqual(b.kinds, ['ok']);
	});

	test('CRDT stores are judged on their own', () => {
		assert.equal(
			badgeFor(crdt({ upload: true, download: true }), 'xacts')!.text,
			'Upload / Download'
		);
		assert.equal(badgeFor(crdt({ upload: true }), 'xacts')!.text, 'Upload needed');
		assert.equal(badgeFor(crdt({ download: true }), 'xacts')!.text, 'Download available');
		assert.equal(badgeFor(crdt({}), 'xacts')!.text, 'In sync');
	});
});

describe('describeItem', () => {
	test('empty bucket', () => {
		assert.equal(
			describeItem({ lastModified: null, count: 0 }, 'settings'),
			'Nothing in the bucket'
		);
	});

	test('file count only for Beancount, with singular and plural', () => {
		assert.match(
			describeItem({ lastModified: null, count: 1 }, 'beancount'),
			/unknown time · 1 file$/
		);
		assert.match(describeItem({ lastModified: null, count: 2 }, 'beancount'), /2 files$/);
		assert.equal(describeItem({ lastModified: null, count: 2 }, 'xacts'), 'unknown time');
	});

	test('mentions other devices when present', () => {
		const d = new Date(2026, 0, 2, 3, 4, 5);
		const text = describeItem({ lastModified: d, count: 1, otherDeviceModified: d }, 'xacts');
		assert.include(text, d.toLocaleString());
		assert.include(text, 'other devices: ');
	});
});

describe('touchesLedger', () => {
	test('downloaded transactions and files, or deleted files, reach the ledger', () => {
		assert.isTrue(touchesLedger([line('xacts', 'downloaded')]));
		assert.isTrue(touchesLedger([line('beancount', 'downloaded')]));
		assert.isTrue(touchesLedger([line('beancount', 'deleted')]));
	});

	test('uploads, settings and scheduled transactions do not', () => {
		assert.isFalse(touchesLedger([line('xacts', 'uploaded')]));
		assert.isFalse(touchesLedger([line('settings', 'downloaded')]));
		assert.isFalse(touchesLedger([line('scheduled', 'downloaded')]));
		assert.isFalse(touchesLedger([]));
	});
});

describe('isCleanRun', () => {
	test('conflicts, errors and pending deletes need the user', () => {
		assert.isFalse(isCleanRun([line('beancount', 'conflict')]));
		assert.isFalse(isCleanRun([line('beancount', 'error')]));
		assert.isFalse(isCleanRun([line('beancount', 'pending-delete')]));
	});

	test('everything else is clean', () => {
		assert.isTrue(isCleanRun([line('xacts', 'uploaded'), line('settings', 'unchanged')]));
		assert.isTrue(isCleanRun([]));
	});
});
