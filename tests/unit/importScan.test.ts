/*
	importScan tests — pure decisions of the import-ledger page. See src/lib/utils/importScan.ts.
*/

import { parseSpecs } from '#lib/utils/fsScan';
import {
	classifyFile,
	countStatuses,
	filesToCopy,
	filesToDelete,
	findDeleted,
	importCount,
	normalizeLineEndings,
	planManifestRebuild,
	type ScannedFile
} from '#lib/utils/importScan';
import type { ImportedFileMeta } from '#lib/utils/importManifest';
import { assert, describe, test } from 'vitest';

const file = (path: string, status: ScannedFile['status']): ScannedFile => ({
	path,
	size: 1,
	lastModified: 1,
	status
});

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
	test('no manifest entry means new', () => {
		assert.equal(classifyFile(undefined, { size: 1, lastModified: 1 }), 'new');
	});

	test('same size and mtime is identical', () => {
		assert.equal(classifyFile(meta('a', 5, 9), { size: 5, lastModified: 9 }), 'identical');
	});

	test('a different size or mtime is modified', () => {
		assert.equal(classifyFile(meta('a', 5, 9), { size: 6, lastModified: 9 }), 'modified');
		assert.equal(classifyFile(meta('a', 5, 9), { size: 5, lastModified: 10 }), 'modified');
	});
});

describe('findDeleted', () => {
	test('manifest entries missing from the source become deleted rows', () => {
		const manifest = new Map([
			['kept.bean', meta('kept.bean', 1, 2)],
			['gone.bean', meta('gone.bean', 3, 4)]
		]);
		const deleted = findDeleted(manifest, new Set(['kept.bean']));
		assert.deepEqual(deleted, [{ path: 'gone.bean', size: 3, lastModified: 4, status: 'deleted' }]);
	});

	test('nothing deleted when everything is seen', () => {
		assert.deepEqual(findDeleted(new Map([['a', meta('a', 1, 1)]]), new Set(['a'])), []);
	});
});

describe('selection', () => {
	const files = [
		file('n', 'new'),
		file('m', 'modified'),
		file('i', 'identical'),
		file('d', 'deleted')
	];

	test('countStatuses tallies every status, including zeros', () => {
		assert.deepEqual(countStatuses(files), { new: 1, modified: 1, identical: 1, deleted: 1 });
		assert.deepEqual(countStatuses([]), { new: 0, modified: 0, identical: 0, deleted: 0 });
	});

	test('"modified" mode copies only changed files', () => {
		assert.deepEqual(
			filesToCopy(files, 'modified').map((f) => f.path),
			['n', 'm']
		);
	});

	test('"all" mode copies everything still in the source', () => {
		assert.deepEqual(
			filesToCopy(files, 'all').map((f) => f.path),
			['n', 'm', 'i']
		);
	});

	test('deletions are the deleted rows in either mode', () => {
		assert.deepEqual(
			filesToDelete(files).map((f) => f.path),
			['d']
		);
	});

	test('importCount: non-identical files in "modified" mode, all rows in "all" mode', () => {
		assert.equal(importCount(files, 'modified'), 3);
		assert.equal(importCount(files, 'all'), 4);
	});
});

test('normalizeLineEndings turns CRLF into LF', () => {
	assert.equal(normalizeLineEndings('a\r\nb\r\n'), 'a\nb\n');
	assert.equal(normalizeLineEndings('a\nb'), 'a\nb');
});

describe('planManifestRebuild', () => {
	const entry = (path: string, size?: number, lastModified?: number, kind = 'file') => ({
		kind,
		path,
		name: path.split('/').pop()!,
		size,
		lastModified
	});
	const patterns = parseSpecs('*.bean');
	const rebuild = (manifest: Map<string, ImportedFileMeta>, tree: ReturnType<typeof entry>[]) =>
		planManifestRebuild(manifest, tree, patterns, '.cashier/', 999);

	test('adds new files with the current time as importedAt', () => {
		const { upserts, stale } = rebuild(new Map(), [entry('a.bean', 5, 6)]);
		assert.deepEqual(upserts, [meta('a.bean', 5, 6, 999)]);
		assert.deepEqual(stale, []);
	});

	test('leaves unchanged files alone', () => {
		const { upserts } = rebuild(new Map([['a.bean', meta('a.bean', 5, 6)]]), [
			entry('a.bean', 5, 6)
		]);
		assert.deepEqual(upserts, []);
	});

	test('updates changed files but keeps their importedAt', () => {
		const { upserts } = rebuild(new Map([['a.bean', meta('a.bean', 5, 6, 42)]]), [
			entry('a.bean', 7, 6)
		]);
		assert.deepEqual(upserts, [meta('a.bean', 7, 6, 42)]);
	});

	test('drops manifest entries whose file is gone', () => {
		const { stale } = rebuild(new Map([['gone.bean', meta('gone.bean', 1, 1)]]), []);
		assert.deepEqual(stale, ['gone.bean']);
	});

	test('skips directories, internal data, non-matching names and entries without metadata', () => {
		const { upserts, stale } = rebuild(
			new Map([['.cashier/x.bean', meta('.cashier/x.bean', 1, 1)]]),
			[
				entry('dir', 1, 1, 'directory'),
				entry('.cashier/x.bean', 1, 1),
				entry('notes.txt', 1, 1),
				entry('nometa.bean')
			]
		);
		assert.deepEqual(upserts, []);
		// An excluded file counts as absent, so its stale manifest entry is dropped.
		assert.deepEqual(stale, ['.cashier/x.bean']);
	});
});
