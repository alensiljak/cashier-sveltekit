/*
    Import manifest (IndexedDB): which imported files are known, used to detect
    new/modified/deleted files on the next scan. Runs on fake IndexedDB.
*/
import { beforeEach, describe, expect, it } from 'vitest';
import {
	deleteManifestEntries,
	deleteManifestEntry,
	getManifest,
	putManifestEntries,
	putManifestEntry,
	type ImportedFileMeta
} from '$lib/utils/importManifest';

const meta = (path: string, size = 10, lastModified = 1000): ImportedFileMeta => ({
	path,
	size,
	lastModified,
	importedAt: 5000
});

beforeEach(async () => {
	await deleteManifestEntries([...(await getManifest()).keys()]);
});

describe('importManifest', () => {
	it('starts empty', async () => {
		expect((await getManifest()).size).toBe(0);
	});

	it('stores and reads back an entry keyed by path', async () => {
		await putManifestEntry(meta('books/a.bean'));

		const manifest = await getManifest();

		expect(manifest.get('books/a.bean')).toEqual(meta('books/a.bean'));
	});

	it('overwrites an entry with the same path', async () => {
		await putManifestEntry(meta('a.bean', 10, 1000));
		await putManifestEntry(meta('a.bean', 20, 2000));

		const manifest = await getManifest();

		expect(manifest.size).toBe(1);
		expect(manifest.get('a.bean')).toMatchObject({ size: 20, lastModified: 2000 });
	});

	it('stores several entries in one go, and ignores an empty batch', async () => {
		await putManifestEntries([]);
		await putManifestEntries([meta('a'), meta('b'), meta('c')]);

		expect([...(await getManifest()).keys()].sort()).toEqual(['a', 'b', 'c']);
	});

	it('deletes one or several entries, ignoring unknown paths and empty batches', async () => {
		await putManifestEntries([meta('a'), meta('b'), meta('c')]);

		await deleteManifestEntry('a');
		await deleteManifestEntries(['b', 'does-not-exist']);
		await deleteManifestEntries([]);

		expect([...(await getManifest()).keys()]).toEqual(['c']);
	});
});
