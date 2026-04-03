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
import appService from '$lib/services/appService';
import * as RledgerParser from '$lib/utils/rledgerParser';
import db from '$lib/data/db';

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

async function readMainBeancountFile(): Promise<{ fileName: string; content: string; dirHandle: FileSystemDirectoryHandle }> {
    const fullBookRoot = await settings.get<string>(SettingKeys.fullBookRoot);
    if (!fullBookRoot) {
        throw new Error('No book root file configured. Please select a file in the fs-sync page.');
    }

    const parts = fullBookRoot.split('/');
    const fileName = parts.pop();
    if (!fileName) {
        throw new Error('Invalid fullBookRoot path');
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

async function readFileFromDir(dirHandle: FileSystemDirectoryHandle, filename: string): Promise<string> {
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
    const dir = parentPath.includes('/') ? parentPath.substring(0, parentPath.lastIndexOf('/') + 1) : '';
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
    console.log('Synchronization starting...');

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

        if (syncOptions.syncAccounts) {
            // - accounts with balances
            await syncAccountsFromFs(queries, fileMap, mainFileName);
        }

        // - opening balances
        // TODO
        if (syncOptions.syncAaValues) {
        }

        if (syncOptions.syncPayees) {
            // - payees
            await syncPayeesFromFs(queries, fileMap, mainFileName);
        }

        // Asset Allocation definition (.toml)
        // TODO

    } catch (error) {
        console.error('Synchronization error:', error);
        throw error;
    }
}

async function syncAccountsFromFs(queries: ReturnType<typeof getQueries>,
    fileMap: Record<string, string>, mainFileName: string) {
    // const balancesQuery = queries.balances();
    const query = queries.accounts();
    const result = queryMultiFile(fileMap, mainFileName, query);

    // parse accounts: [account, balance, currency]
    const accounts = result.rows.map((row: any) => ({
        balance: row[0],
        currency: row[1],
        account: row[2],
    }));

    const entities = accounts.map((item: any) => 
        RledgerParser.parseBalanceSheetRow(item));
    
    await appService.deleteAccounts();

    // insert accounts
    await db.accounts.bulkPut(entities);
}

async function syncPayeesFromFs(queries: ReturnType<typeof getQueries>,
    fileMap: Record<string, string>, mainFileName: string) {
    const from = moment().subtract(20, 'years').format(ISODATEFORMAT);
    const payeesQuery = queries.payees(from);

    const payeesResult = queryMultiFile(fileMap, mainFileName, payeesQuery);
    // console.log('Payees result:', payeesResult);

    // Parse the result into a string[] of payee names, then store via common.
    const payees = payeesResult.rows.map((row: any) => row);

    await syncCommon.syncPayees(payees);
}

export { synchronize };
