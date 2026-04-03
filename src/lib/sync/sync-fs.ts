/**
 * Sync source: Filesystem + Rust Ledger WASM.
 * Reads Beancount files from the local filesystem via File System API,
 * parses them with Rust Ledger WASM, and runs queries.
 */

import { settings, SettingKeys } from '$lib/settings';
import { ensureInitialized, parseMultiFile, queryMultiFile } from '$lib/services/rustledger';
import { getQueries } from './sync-queries';
import moment from 'moment';
import { ISODATEFORMAT, PtaSystems } from '$lib/constants';
import * as syncCommon from '$lib/sync/sync-common';
import * as RledgerParser from '$lib/utils/rledgerParser';
import type { Account } from '$lib/data/model';
import { OPFSBackend } from '$lib/storage';
import Notifier from '$lib/utils/notifier';

// IndexedDB persistence for directory handle
const IDB_NAME = 'cashier-fs-handles';
const IDB_STORE = 'handles';
const HANDLE_KEY = 'fsSyncDirectoryHandle';

function openIdb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(IDB_NAME, 1);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(IDB_STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function loadPersistedHandle(): Promise<FileSystemDirectoryHandle | null> {
	try {
		const db = await openIdb();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(IDB_STORE, 'readonly');
			const req = tx.objectStore(IDB_STORE).get(HANDLE_KEY);
			req.onsuccess = () => {
				db.close();
				resolve(req.result ?? null);
			};
			req.onerror = () => {
				db.close();
				reject(req.error);
			};
		});
	} catch {
		return null;
	}
}

async function readMainBeancountFile(): Promise<{
	fileName: string;
	content: string;
	dirHandle: FileSystemDirectoryHandle;
}> {
	const externalBook = await settings.get<string>(SettingKeys.externalBook);
	if (!externalBook) {
		throw new Error('No book root file configured. Please select a file in the fs-sync page.');
	}

	const parts = externalBook.split('/');
	const fileName = parts.pop();
	if (!fileName) {
		throw new Error('Invalid externalBook path');
	}

	const dirHandle = await loadPersistedHandle();
	if (!dirHandle) {
		throw new Error('No directory selected. Please open a directory in the fs-sync page.');
	}

	const permission = await (dirHandle as any).requestPermission({ mode: 'read' });
	if (permission !== 'granted') {
		throw new Error('Read permission denied for directory');
	}

	const fileHandle = await dirHandle.getFileHandle(fileName);
	const file = await fileHandle.getFile();
	const content = await file.text();

	return { fileName, content, dirHandle };
}

function parseIncludeFilenames(content: string): string[] {
	const filenames: string[] = [];
	const regex = /^include\s+"([^"]+)"/gm;
	let match;
	while ((match = regex.exec(content)) !== null) {
		filenames.push(match[1]);
	}
	return filenames;
}

async function readFileFromDir(
	dirHandle: FileSystemDirectoryHandle,
	filename: string
): Promise<string> {
	const parts = filename.split('/');
	let currentDir: FileSystemDirectoryHandle = dirHandle;
	for (const part of parts.slice(0, -1)) {
		currentDir = await currentDir.getDirectoryHandle(part);
	}
	const fileHandle = await currentDir.getFileHandle(parts[parts.length - 1]);
	const file = await fileHandle.getFile();
	return file.text();
}

function resolveIncludePath(parentPath: string, includePath: string): string {
	const dir = parentPath.includes('/')
		? parentPath.substring(0, parentPath.lastIndexOf('/') + 1)
		: '';
	return dir + includePath;
}

async function collectAllFiles(
	dirHandle: FileSystemDirectoryHandle,
	filePath: string,
	content: string,
	fileMap: Record<string, string>
): Promise<void> {
	fileMap[filePath] = content;
	const includes = parseIncludeFilenames(content);
	await Promise.all(
		includes.map(async (inc) => {
			const resolved = resolveIncludePath(filePath, inc);
			if (resolved in fileMap) return;
			const incContent = await readFileFromDir(dirHandle, resolved);
			await collectAllFiles(dirHandle, resolved, incContent, fileMap);
		})
	);
}

/**
 * Load all beancount files from the filesystem, resolving includes.
 */
async function loadFileMap(): Promise<{ fileMap: Record<string, string>; mainFileName: string }> {
	const { fileName: mainFileName, content: mainContent, dirHandle } = await readMainBeancountFile();

	const fileMap: Record<string, string> = {};
	await collectAllFiles(dirHandle, mainFileName, mainContent, fileMap);

	return { fileMap, mainFileName };
}

async function synchronize(syncOptions: syncCommon.SyncOptions): Promise<void> {
	try {
		const { fileMap, mainFileName } = await loadFileMap();

		// Parse all files together with include resolution.
		await ensureInitialized();
		const parseResult = parseMultiFile(fileMap, mainFileName);

		if (parseResult.errors.length > 0) {
			console.log('Parse errors:', parseResult.errors);
			throw new Error('Parsing errors occurred. See console for details.');
		}

		// Run queries and store results via sync-common.
		const queries = getQueries(PtaSystems.rledger);

		// Synchronization steps:

		// - accounts list
		if (syncOptions.syncAccounts) {
			await syncAccountsFromFs(queries, fileMap, mainFileName);
		}

		// - opening balances
		if (syncOptions.syncOpeningBalances) {
			await syncAccountBalances(queries, fileMap, mainFileName);
		}

		// Asset Allocation definition (.toml)
		if (syncOptions.syncAssetAllocation) {
			await syncAssetAllocation();
		}

		// - current values in the base currency (for asset allocation)
		if (syncOptions.syncAaValues) {
			console.log('Syncing AA values from filesystem is not implemented yet');
			Notifier.warning('Syncing AA values from filesystem is not implemented yet');
		}

		if (syncOptions.syncPayees) {
			// - payees
			await syncPayeesFromFs(queries, fileMap, mainFileName);
		}
	} catch (error) {
		console.error('Synchronization error:', error);
		throw error;
	}
}

async function syncAccountsFromFs(
	queries: ReturnType<typeof getQueries>,
	fileMap: Record<string, string>,
	mainFileName: string
) {
	// const balancesQuery = queries.balances();
	const query = queries.openAccounts();
	const result = queryMultiFile(fileMap, mainFileName, query);

	const entities = result.rows.map((item: any) => {
		const accountName = item[0];
		const openDate = item[1];
		return { name: accountName, openDate };
	});

	const accountDirectives = await createAccountDirectives(entities);
	const filename = 'accounts.bean';
	const opfs = new OPFSBackend();
	await opfs.writeFile(filename, accountDirectives);
}

async function syncAccountBalances(
	queries: ReturnType<typeof getQueries>,
	fileMap: Record<string, string>,
	mainFileName: string
) {
	const query = queries.accounts();
	const result = queryMultiFile(fileMap, mainFileName, query);

	// parse accounts: [account, balance, currency]
	const accounts = result.rows.map((row: any) => ({
		balance: row[0],
		currency: row[1],
		account: row[2]
	}));

	const entities = accounts.map((item: any) => RledgerParser.parseBalanceSheetRow(item));
	const record = createOpeningBalancesDirective(entities);

	// Instead of saving to the database, save to the initialization file.
	await saveOpeningBalances(record);
}

async function createAccountDirectives(
	entities: { name: string; openDate: string }[]
): Promise<string> {
	const lines: string[] = [];
	for (const entity of entities) {
		lines.push(`${entity.openDate} open ${entity.name}`);
	}
	const content = lines.join('\n');
	return content;
}

/**
 * Save opening balances record to the book.bean file in OPFS.
 * Replaces the existing opening balances transaction in place, preserving
 * all other directives (options, plugins, etc.). If none exists, appends.
 * Creates the file if it does not exist.
 */
async function saveOpeningBalances(record: string) {
	const opfs = new OPFSBackend();
	const filename = 'opening-balances.bean';

	await opfs.writeFile(filename, record);
}

/**
 * Creates transaction directives for opening balances based on the list of accounts.
 * @param accounts List of accounts with balances.
 */
function createOpeningBalancesDirective(accounts: Account[]): string {
	const date = moment().format(ISODATEFORMAT);
	const lines: string[] = [`${date} * "Opening Balances"`];

	for (const account of accounts) {
		if (!account.balances) continue;
		for (const [currency, amount] of Object.entries(account.balances)) {
			if (amount === 0) continue;
			const formatted = amount.toFixed(8).replace(/\.?0+$/, '');
			lines.push(`    ${account.name}  ${formatted} ${currency}`);
		}
	}

	lines.push(`    Equity:Opening-Balances`);

	const record = lines.join('\n');
	return record;
}

/**
 * Read the marked Asset Allocation file from external filesystem and
 * store into OPFS.
 */
async function syncAssetAllocation() {
	const assetAllocationFile = await settings.get<string>(SettingKeys.externalAssetAllocation);
	if (!assetAllocationFile) {
		throw new Error(
			'No asset allocation file configured. Please select a file in the Configuration.'
		);
	}

	const dirHandle = await loadPersistedHandle();
	if (!dirHandle) {
		throw new Error('No directory selected. Please open a directory in the fs-sync page.');
	}

	const permission = await (dirHandle as any).requestPermission({ mode: 'read' });
	if (permission !== 'granted') {
		throw new Error('Read permission denied for directory');
	}

	// Extract relative path from the stored full path (which includes directory name)
	const parts = assetAllocationFile.split('/');
	const relativePath = parts.slice(1).join('/'); // Remove the directory name prefix

	const content = await readFileFromDir(dirHandle, relativePath);
	const opfs = new OPFSBackend();
	await opfs.writeFile('asset-allocation.toml', content);
}

async function syncPayeesFromFs(
	queries: ReturnType<typeof getQueries>,
	fileMap: Record<string, string>,
	mainFileName: string
) {
	const from = moment().subtract(20, 'years').format(ISODATEFORMAT);
	const payeesQuery = queries.payees(from);

	const payeesResult = queryMultiFile(fileMap, mainFileName, payeesQuery);

	// Parse the result into a string[] of payee names, then store via common.
	const payees = payeesResult.rows.map((row: any) => row);

	await syncCommon.syncPayees(payees);
}

export { synchronize };
