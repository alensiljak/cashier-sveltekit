/**
 * Sync source: Filesystem + Rust Ledger WASM.
 * Reads Beancount files from the local filesystem via File System API,
 * parses them with Rust Ledger WASM, and runs queries.
 */

import { settings, SettingKeys } from '$lib/settings';
import fullLedgerService from '$lib/services/fullLedgerService';
import { getQueries } from './sync-queries';
import moment from 'moment';
import { ISODATEFORMAT } from '$lib/constants';
import { LedgerFilenames, PtaSystems } from '$lib/enums';
import * as syncCommon from '$lib/sync/sync-common';
import * as RledgerParser from '$lib/utils/rledgerParser';
import { Account, Money } from '$lib/data/model';
import { OPFSBackend } from '$lib/storage';
import type { CurrentValuesDict } from '$lib/data/viewModels';
import { AssetAllocationEngine } from '$lib/assetAllocation/AssetAllocation';
import {
	syncProgress,
	initializeSyncProgress,
	updateSyncStep
} from '$lib/stores/syncProgressStore';
import { createAccountsFile } from '$lib/services/accountsService';
import type { AccountFileEntry } from '$lib/data/opfsTypes';

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

async function readExternalBeancountFile(): Promise<{
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
export async function loadFileMap(): Promise<{
	fileMap: Record<string, string>;
	mainFileName: string;
	dirHandle: FileSystemDirectoryHandle;
}> {
	const { fileName: mainFileName, content: mainContent, dirHandle } = await readExternalBeancountFile();

	const fileMap: Record<string, string> = {};
	await collectAllFiles(dirHandle, mainFileName, mainContent, fileMap);

	return { fileMap, mainFileName, dirHandle };
}

async function synchronize(syncOptions: syncCommon.SyncSteps): Promise<boolean> {
	try {
		// Initialize sync progress
		initializeSyncProgress();

		// Parse all files once and cache in the full ledger singleton.
		await fullLedgerService.invalidate();

		const errors = fullLedgerService.getErrors();
		if (errors.length > 0) {
			console.log('Parse errors:', errors);
			throw new Error('Parsing errors occurred. See console for details.');
		}

		// Run queries and store results via sync-common.
		const queries = getQueries(PtaSystems.rledger);

		// Synchronization steps:

		// - accounts list
		if (syncOptions.syncAccounts) {
			updateSyncStep(1, 'in-progress');
			await syncAccounts(queries);
			updateSyncStep(1, 'completed');
		}

		// - opening balances
		if (syncOptions.syncOpeningBalances) {
			updateSyncStep(2, 'in-progress');
			await syncAccountBalances(queries);
			updateSyncStep(2, 'completed');
		}

		// Asset Allocation definition (.toml)
		if (syncOptions.syncAssetAllocation) {
			updateSyncStep(3, 'in-progress');
			await syncAssetAllocation(fullLedgerService.dirHandle ?? undefined);
			updateSyncStep(3, 'completed');
		}

		// - current values in the base currency (for asset allocation)
		if (syncOptions.syncAaValues) {
			updateSyncStep(4, 'in-progress');
			await syncCurrentValues(queries);
			updateSyncStep(4, 'completed');
		}

		// - payees
		if (syncOptions.syncPayees) {
			updateSyncStep(5, 'in-progress');
			await syncPayees(queries);
			updateSyncStep(5, 'completed');
		}

		return true;

	} catch (error) {
		console.error('Synchronization error:', error);
		// Update the current step to error
		syncProgress.update((steps) => {
			const currentStep = steps.find((step) => step.status === 'in-progress');
			if (currentStep) {
				return steps.map((step) =>
					step.id === currentStep.id ? { ...step, status: 'error' } : step
				);
			}
			return steps;
		});
		throw error;
	}
}

/**
 * The list of open accounts with opening dates.
 * @param queries
 * @param fileMap
 * @param mainFileName
 */
async function syncAccounts(
	queries: ReturnType<typeof getQueries>
) {
	const query = queries.openAccounts();
	const result = fullLedgerService.query(query);

	const entities: AccountFileEntry[] = result.rows.map((item: any) => ({
		name: item[0], 
		openDate: item[1],
		currencies: item[2]
	}));

	await createAccountsFile(entities);
}

/**
 * Balances can only be retrieved from #transactions.
 * @param queries
 * @param fileMap
 * @param mainFileName
 */
async function syncAccountBalances(
	queries: ReturnType<typeof getQueries>
) {
	const query = queries.accounts();
	const result = fullLedgerService.query(query);

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

/**
 * Save opening balances record to the book.bean file in OPFS.
 * Replaces the existing opening balances transaction in place, preserving
 * all other directives (options, plugins, etc.). If none exists, appends.
 * Creates the file if it does not exist.
 */
async function saveOpeningBalances(record: string) {
	const opfs = new OPFSBackend();
	const filename = LedgerFilenames.openingBalances;

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
async function syncAssetAllocation(dirHandle?: FileSystemDirectoryHandle) {
	const source = await settings.get<string>(SettingKeys.externalAssetAllocation);
	if (!source) {
		throw new Error(
			'No asset allocation file configured. Please select a file in the Configuration.'
		);
	}

	if (!dirHandle) {
		dirHandle = (await loadPersistedHandle()) ?? undefined;
		if (!dirHandle) {
			throw new Error('No directory selected. Please open a directory in the fs-sync page.');
		}
		const permission = await (dirHandle as any).requestPermission({ mode: 'read' });
		if (permission !== 'granted') {
			throw new Error('Read permission denied for directory');
		}
	}

	// Extract relative path from the stored full path (which includes directory name)
	const parts = source.split('/');
	const relativePath = parts.slice(1).join('/'); // Remove the directory name prefix

	const content = await readFileFromDir(dirHandle, relativePath);
	
	// Save to OPFS.
	const opfs = new OPFSBackend();
	await opfs.writeFile(LedgerFilenames.asset_allocation, content);
}

/**
 * Current values in base currency. Used for asset allocation.
 * @param queries
 * @param fileMap
 * @param mainFileName
 */
async function syncCurrentValues(
	queries: ReturnType<typeof getQueries>
) {
	// currentValues query
	const rootAccount = (await settings.get(SettingKeys.rootInvestmentAccount)) as string;
	if (!rootAccount) {
		throw new Error('No root investment account set!');
	}
	const currency = await settings.get<string>(SettingKeys.currency);
	if (!currency) {
		throw new Error('No default currency set!');
	}

	const query = queries.currentValues(rootAccount, currency);
	const result = fullLedgerService.query(query);
	// result = { columns, errors, rows }

	if (result.errors.length > 0) {
		console.log('Query errors:', result.errors);
		throw new Error('Errors occurred during query execution. See console for details.');
	}

	// row = [account, value]
	// creates { "account": amount }
	const currentValues: CurrentValuesDict = {};
	result.rows.forEach((row: any) => {
		currentValues[row[0]] = Money.fromString(row[1]);
	});

	const aa = new AssetAllocationEngine();
	await aa.importCurrentValues(currentValues);
}

async function syncPayees(
	queries: ReturnType<typeof getQueries>
) {
	// const from = moment().subtract(20, 'years').format(ISODATEFORMAT);
	const payeesQuery = queries.payees();

	const payeesResult = fullLedgerService.query(payeesQuery);

	// Parse the result into a string[] of payee names, then store via common.
	const payees = payeesResult.rows.map((row: any) => row);

	await syncCommon.syncPayees(payees);
}

export { synchronize };
