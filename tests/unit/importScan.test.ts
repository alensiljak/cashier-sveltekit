/*
	importScan tests — pure decisions of the import-ledger page. See src/lib/utils/importScan.ts.
*/

import { isInHiddenDirectory, parseSpecs } from '#lib/utils/fsScan';
import {
	classifyFile,
	countStatuses,
	filesToCopy,
	filesToDelete,
	findDeleted,
	importCount,
	isSameContent,
	type ScannedFile
} from '#lib/utils/importScan';
import type { ImportedFileMeta } from '#lib/utils/importManifest';
import { assert, describe, test } from 'vitest';

const file = (
	path: string,
	status: ScannedFile['status'],
	extra: Partial<ScannedFile> = {}
): ScannedFile => ({ path, size: 1, lastModified: 1, status, ...extra });

const meta = (
	path: string,
	size: number,
	lastModified: number,
	importedAt = 100
): ImportedFileMeta => ({
	path,
	size,
	lastModified,
	importedAt
});

describe('classifyFile', () => {
	const source = { size: 5, lastModified: 9 };
	const same = meta('a', 5, 9, 100);
	const stale = meta('a', 5, 8, 100);
	const untouched = { lastModified: 100 };
	const touched = { lastModified: 101 };
	const equal = async (): Promise<[string, string]> => ['x\r\n', 'x\n'];
	const differ = async (): Promise<[string, string]> => ['x', 'y'];

	test('no OPFS file means new, whatever the manifest says', async () => {
		const result = await classifyFile(source, same, undefined, differ);
		assert.deepEqual(result, { status: 'new', record: false });
	});

	test('unchanged times on both sides are identical without reading', async () => {
		const result = await classifyFile(source, same, untouched, () => {
			throw new Error('must not read');
		});
		assert.deepEqual(result, { status: 'identical', record: false });
	});

	test('equal contents after a change are identical and recorded', async () => {
		for (const [prev, opfs] of [
			[stale, untouched],
			[same, touched],
			[stale, touched],
			[undefined, untouched]
		] as const) {
			const result = await classifyFile(source, prev, opfs, equal);
			assert.deepEqual(result, { status: 'identical', record: true });
		}
	});

	test('differing contents are classified by the side that changed', async () => {
		const status = async (prev: ImportedFileMeta | undefined, opfs: { lastModified?: number }) =>
			(await classifyFile(source, prev, opfs, differ)).status;
		assert.equal(await status(stale, untouched), 'modified');
		assert.equal(await status(same, touched), 'local');
		assert.equal(await status(stale, touched), 'conflict');
		// No history: either side could be the newer one.
		assert.equal(await status(undefined, untouched), 'conflict');
		// An unknown OPFS time counts as changed.
		assert.equal(await status(same, {}), 'local');
	});
});

describe('findDeleted', () => {
	test('manifest entries missing from the source become deleted rows', () => {
		const manifest = new Map([
			['kept.bean', meta('kept.bean', 1, 2)],
			['gone.bean', meta('gone.bean', 3, 4)]
		]);
		const deleted = findDeleted(
			manifest,
			new Set(['kept.bean']),
			new Map([['gone.bean', { lastModified: 100 }]])
		);
		assert.deepEqual(deleted, [
			{ path: 'gone.bean', size: 3, lastModified: 4, status: 'deleted', sourceMissing: true }
		]);
	});

	test('a file changed in OPFS since the import is a conflict', () => {
		const [row] = findDeleted(
			new Map([['a', meta('a', 1, 1)]]),
			new Set(),
			new Map([['a', { lastModified: 101 }]])
		);
		assert.equal(row.status, 'conflict');
		assert.isTrue(row.sourceMissing);
	});

	test('nothing deleted when everything is seen', () => {
		assert.deepEqual(findDeleted(new Map([['a', meta('a', 1, 1)]]), new Set(['a']), new Map()), []);
	});
});

describe('selection', () => {
	const files = [
		file('n', 'new'),
		file('m', 'modified'),
		file('l', 'local'),
		file('c', 'conflict'),
		file('i', 'identical'),
		file('d', 'deleted', { sourceMissing: true }),
		file('dc', 'conflict', { sourceMissing: true })
	];
	const ticked = files.map((f) => ({ ...f, overwrite: true }));
	const paths = (rows: ScannedFile[]) => rows.map((f) => f.path);

	test('countStatuses tallies every status, including zeros', () => {
		assert.deepEqual(countStatuses(files), {
			new: 1,
			modified: 1,
			local: 1,
			conflict: 2,
			identical: 1,
			deleted: 1
		});
		assert.deepEqual(countStatuses([]), {
			new: 0,
			modified: 0,
			local: 0,
			conflict: 0,
			identical: 0,
			deleted: 0
		});
	});

	test('by default, files with changes in OPFS are neither overwritten nor deleted', () => {
		assert.deepEqual(paths(filesToCopy(files, 'modified')), ['n', 'm']);
		assert.deepEqual(paths(filesToDelete(files)), ['d']);
		assert.equal(importCount(files, 'modified'), 3);
	});

	test('ticked rows are overwritten or deleted', () => {
		assert.deepEqual(paths(filesToCopy(ticked, 'modified')), ['n', 'm', 'l', 'c']);
		assert.deepEqual(paths(filesToDelete(ticked)), ['d', 'dc']);
	});

	test('"all" mode copies everything in the source but still protects unticked deletions', () => {
		assert.deepEqual(paths(filesToCopy(files, 'all')), ['n', 'm', 'l', 'c', 'i']);
		assert.deepEqual(paths(filesToDelete(files)), ['d']);
		assert.equal(importCount(files, 'all'), 6);
	});
});

test('isSameContent ignores line endings and the final newline only', () => {
	assert.isTrue(isSameContent('a\r\nb\r\n', 'a\nb\n'));
	assert.isTrue(isSameContent('a\nb', 'a\nb\n'));
	assert.isFalse(isSameContent('a\n', 'a\n\n'));
	assert.isFalse(isSameContent('a', 'b'));
});
