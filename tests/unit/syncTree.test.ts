/*
	syncTree tests — pure row/tree building, counting and banner logic used by
	the Beancount sync page. See src/lib/sync/syncTree.ts.
*/

import type { DiffEntry, SyncAction } from '#lib/sync/syncDiff';
import type { SyncEntry } from '#lib/sync/SyncSource';
import {
	buildFileRows,
	buildTree,
	countActions,
	countPeerDiffs,
	formatFileSize,
	previewBanner,
	type TreeRow
} from '#lib/sync/syncTree';
import { assert, describe, test } from 'vitest';

function entry(path: string, hash = 'h'): SyncEntry {
	return { path, size: 10, lastModified: 1000, hash };
}

function diff(path: string, status: DiffEntry['status'], action: SyncAction): DiffEntry {
	return { path, status, action };
}

function diffMap(...entries: DiffEntry[]): Map<string, DiffEntry> {
	return new Map(entries.map((e) => [e.path, e]));
}

describe('buildFileRows', () => {
	test('unions local and remote paths', () => {
		const rows = buildFileRows(
			[entry('a.bean'), entry('both.bean')],
			[entry('b.bean'), entry('both.bean')],
			new Map(),
			new Map()
		);
		const byPath = new Map(rows.map((r) => [r.path, r]));
		assert.equal(rows.length, 3);
		assert.isOk(byPath.get('a.bean')!.local);
		assert.isUndefined(byPath.get('a.bean')!.remote);
		assert.isUndefined(byPath.get('b.bean')!.local);
		assert.isOk(byPath.get('both.bean')!.local && byPath.get('both.bean')!.remote);
	});

	test('depth and name come from the path', () => {
		const [row] = buildFileRows([entry('x/y/z.bean')], [], new Map(), new Map());
		assert.equal(row.name, 'z.bean');
		assert.equal(row.depth, 2);
	});

	test('a user override beats the default action', () => {
		const diffs = diffMap(diff('a.bean', 'remote-newer', 'pull'));
		const [row] = buildFileRows(
			[entry('a.bean')],
			[entry('a.bean')],
			diffs,
			new Map([['a.bean', 'skip']])
		);
		assert.equal(row.effectiveAction, 'skip');
		assert.equal(row.status, 'remote-newer');
	});

	test('without a diff there is no status or action', () => {
		const [row] = buildFileRows([entry('a.bean')], [], new Map(), new Map());
		assert.isUndefined(row.status);
		assert.isUndefined(row.effectiveAction);
	});
});

describe('buildTree', () => {
	const files = () =>
		buildFileRows(
			[entry('top.bean'), entry('dir/a.bean'), entry('dir/sub/b.bean'), entry('quiet/c.bean')],
			[entry('top.bean'), entry('dir/a.bean'), entry('dir/sub/b.bean'), entry('quiet/c.bean')],
			diffMap(
				diff('top.bean', 'unchanged', 'skip'),
				diff('dir/a.bean', 'remote-newer', 'pull'),
				diff('dir/sub/b.bean', 'conflict', 'conflict'),
				diff('quiet/c.bean', 'unchanged', 'skip')
			),
			new Map()
		);

	test('collapsed directories hide their children; directories sort first', () => {
		const rows = buildTree(files(), new Set(), false);
		assert.deepEqual(
			rows.map((r) => r.path),
			['dir', 'quiet', 'top.bean']
		);
	});

	test('expanding a directory reveals children in order', () => {
		const rows = buildTree(files(), new Set(['dir']), false);
		assert.deepEqual(
			rows.map((r) => r.path),
			['dir', 'dir/sub', 'dir/a.bean', 'quiet', 'top.bean']
		);
		assert.equal(rows.find((r) => r.path === 'dir')!.depth, 0);
		assert.equal(rows.find((r) => r.path === 'dir/sub')!.depth, 1);
	});

	test('directory counts cover the whole subtree, even when collapsed', () => {
		const dir = buildTree(files(), new Set(), false).find((r) => r.path === 'dir')!;
		assert.equal(dir.diffCount, 2);
		assert.equal(dir.conflictCount, 1);
	});

	test('diffsOnly drops unchanged files and diff-free directories, and opens the rest', () => {
		const rows = buildTree(files(), new Set(), true);
		assert.deepEqual(
			rows.map((r) => r.path),
			['dir', 'dir/sub', 'dir/sub/b.bean', 'dir/a.bean']
		);
	});
});

describe('countActions', () => {
	const row = (
		path: string,
		status: TreeRow['status'],
		effectiveAction: TreeRow['effectiveAction']
	): TreeRow => ({
		path,
		name: path,
		kind: 'file',
		depth: 0,
		expanded: false,
		status,
		effectiveAction
	});

	test('separates unresolved conflicts from differs and counts pulls', () => {
		const counts = countActions([
			row('a', 'remote-newer', 'pull'),
			row('b', 'conflict', 'pull'), // user resolved to pull
			row('c', 'conflict', 'conflict'),
			row('d', 'differs', 'conflict'),
			row('e', 'differs', 'skip'),
			row('f', 'unchanged', 'skip'),
			row('g', undefined, undefined)
		]);
		assert.deepEqual(counts, { pull: 2, conflict: 1, differs: 1 });
	});
});

describe('countPeerDiffs', () => {
	test('applies overrides and counts differs as conflict', () => {
		const diffs = [
			diff('a', 'remote-newer', 'pull'),
			diff('b', 'remote-newer', 'pull'),
			diff('c', 'conflict', 'conflict'),
			diff('d', 'differs', 'conflict'),
			diff('e', 'local-newer', 'skip')
		];
		assert.deepEqual(countPeerDiffs(diffs, new Map()), { pull: 2, conflict: 2 });
		assert.deepEqual(
			countPeerDiffs(
				diffs,
				new Map<string, SyncAction>([
					['b', 'skip'],
					['c', 'pull']
				])
			),
			{
				pull: 2,
				conflict: 1
			}
		);
	});
});

describe('previewBanner', () => {
	const base: TreeRow = { path: 'a', name: 'a', kind: 'file', depth: 0, expanded: false };

	test('no row, no banner', () => {
		assert.isNull(previewBanner(null));
	});

	test('pull wording depends on which sides exist', () => {
		const e = entry('a');
		assert.match(
			previewBanner({ ...base, effectiveAction: 'pull', local: e })!.text,
			/delete this file locally/
		);
		assert.match(
			previewBanner({ ...base, effectiveAction: 'pull', remote: e })!.text,
			/create this file locally/
		);
		assert.match(
			previewBanner({ ...base, effectiveAction: 'pull', local: e, remote: e })!.text,
			/overwrite/
		);
	});

	test('skip is reassuring; unresolved states warn', () => {
		assert.equal(previewBanner({ ...base, effectiveAction: 'skip' })!.alertClass, 'alert-success');
		assert.match(
			previewBanner({ ...base, effectiveAction: 'conflict', status: 'differs' })!.text,
			/Never synced/
		);
		assert.match(
			previewBanner({ ...base, effectiveAction: 'conflict', status: 'conflict' })!.text,
			/Unresolved conflict/
		);
	});
});

test('formatFileSize', () => {
	assert.equal(formatFileSize(0), '0 B');
	assert.equal(formatFileSize(512), '512 B');
	assert.equal(formatFileSize(1536), '1.5 KB');
	assert.equal(formatFileSize(5 * 1024 * 1024), '5.0 MB');
});
