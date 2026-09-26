/*
    OPFS export: which files are collected, copying into a directory handle,
    and ZIP packing (round-tripped through fflate). OPFS and the destination
    directory are fake in-memory handle trees.
*/
import { describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
	collectExportableFiles,
	exportEntriesToDirectory,
	exportEntriesToZip
} from '$lib/utils/opfsExport';
import { createZipArchive } from '$lib/utils/zip';

// --- fake File System Access handles ---

type Tree = { [name: string]: string | Tree };

function fakeFile(content: string) {
	return {
		kind: 'file' as const,
		getFile: async () => ({
			size: new TextEncoder().encode(content).length,
			text: async () => content,
			arrayBuffer: async () => new TextEncoder().encode(content).buffer
		})
	};
}

function fakeDir(tree: Tree): FileSystemDirectoryHandle {
	return {
		kind: 'directory',
		entries: async function* () {
			for (const [name, value] of Object.entries(tree)) {
				yield [name, typeof value === 'string' ? fakeFile(value) : fakeDir(value)];
			}
		}
	} as unknown as FileSystemDirectoryHandle;
}

/** A writable destination that records what is written where. */
function fakeDestination() {
	const written: Record<string, string> = {};
	const make = (prefix: string): FileSystemDirectoryHandle =>
		({
			getDirectoryHandle: async (name: string) => make(`${prefix}${name}/`),
			getFileHandle: async (name: string) => ({
				createWritable: async () => ({
					write: async (file: { text(): Promise<string> }) => {
						written[`${prefix}${name}`] = await file.text();
					},
					close: async () => {}
				})
			})
		}) as unknown as FileSystemDirectoryHandle;
	return { root: make(''), written };
}

function stubOpfs(tree: Tree) {
	vi.stubGlobal('navigator', { storage: { getDirectory: async () => fakeDir(tree) } });
}

describe('collectExportableFiles', () => {
	it('lists every file recursively, sorted by path, with sizes', async () => {
		stubOpfs({
			'b.bean': 'bbbb',
			books: { '2025.bean': 'x', archive: { 'old.bean': 'yy' } },
			'a.toml': 'aa'
		});

		const files = await collectExportableFiles();

		expect(files.map((f) => [f.path, f.size])).toEqual([
			['a.toml', 2],
			['b.bean', 4],
			['books/2025.bean', 1],
			['books/archive/old.bean', 2]
		]);
	});

	it('excludes the internal cache and the on-device transaction file at the root only', async () => {
		stubOpfs({
			'book.bean': '1',
			'cashier.bean': 'device',
			'.cashier': { 'cache.bin': 'cache' },
			books: { 'cashier.bean': 'kept', '.cashier': { x: 'kept too' } }
		});

		const files = await collectExportableFiles();

		expect(files.map((f) => f.path)).toEqual([
			'book.bean',
			'books/.cashier/x',
			'books/cashier.bean'
		]);
	});

	it('returns nothing for an empty OPFS', async () => {
		stubOpfs({});

		expect(await collectExportableFiles()).toEqual([]);
	});
});

describe('exportEntriesToDirectory', () => {
	it('copies files preserving relative paths and reports progress', async () => {
		stubOpfs({ 'a.bean': 'AAA', books: { 'b.bean': 'BBB' } });
		const entries = await collectExportableFiles();
		const { root, written } = fakeDestination();
		const progress = vi.fn();

		await exportEntriesToDirectory(root, entries, progress);

		expect(written).toEqual({ 'a.bean': 'AAA', 'books/b.bean': 'BBB' });
		expect(progress.mock.calls).toEqual([
			[1, 2, 'a.bean'],
			[2, 2, 'books/b.bean']
		]);
	});
});

describe('exportEntriesToZip', () => {
	it('packs the files into an archive that unpacks to the same content', async () => {
		stubOpfs({ 'a.bean': 'AAA', books: { 'b.bean': 'héllo wörld' } });
		const entries = await collectExportableFiles();
		const progress = vi.fn();

		const zip = await exportEntriesToZip(entries, progress);

		const unpacked = unzipSync(zip);
		expect(Object.keys(unpacked).sort()).toEqual(['a.bean', 'books/b.bean']);
		expect(strFromU8(unpacked['a.bean'])).toBe('AAA');
		expect(strFromU8(unpacked['books/b.bean'])).toBe('héllo wörld');
		expect(progress).toHaveBeenLastCalledWith(2, 2, 'books/b.bean');
	});
});

describe('createZipArchive', () => {
	it('compresses a path -> bytes map', async () => {
		const zip = await createZipArchive({ 'x.txt': new TextEncoder().encode('hello') });

		expect(strFromU8(unzipSync(zip)['x.txt'])).toBe('hello');
	});

	it('produces a valid, empty archive for no files', async () => {
		expect(Object.keys(unzipSync(await createZipArchive({})))).toEqual([]);
	});
});
