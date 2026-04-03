/**
 * Instead of synchronizing with Cashier Server, here we will read the Beancount files
 * from the external filesystem, parse them with Rust Ledger, and run the sync
 * queries, just like with the Cashier Server.
 * Fetch the account opening balances, accounts with balances, commodities, payees.
 * Cache the query results in files in OPFS or IndexDB.

 */

import { settings, SettingKeys } from '$lib/settings';
import { ensureInitialized, parseMultiFile, queryMultiFile } from '$lib/services/rustledger';
import { getQueries } from './sync-queries';
import moment from 'moment';
import { ISODATEFORMAT } from './constants';

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

    // Parse the path: "dirName/filename.beancount"
    const parts = fullBookRoot.split('/');
    const fileName = parts.pop();
    // console.log('Full book root:', fullBookRoot, 'Parsed file name:', fileName);
    if (!fileName) {
        throw new Error('Invalid fullBookRoot path');
    }

    // Get the directory handle from IndexedDB
    const dirHandle = await loadPersistedHandle();
    if (!dirHandle) {
        throw new Error('No directory selected. Please open a directory in the fs-sync page.');
    }

    // Request read permission
    const permission = await (dirHandle as any).requestPermission({ mode: 'read' });
    if (permission !== 'granted') {
        throw new Error('Read permission denied for directory');
    }

    // Get the file handle and read the content
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

async function synchronize() {
    console.log('Synchronization started');

    try {
        // Read the main beancount file and any included files from the filesystem.
        const { fileName: mainFileName, content: mainContent, dirHandle } = await readMainBeancountFile();
        // console.log('Main beancount file loaded, size:', mainContent.length);

        // Recursively collect all included files into fileMap.
        const fileMap: Record<string, string> = {};
        await collectAllFiles(dirHandle, mainFileName, mainContent, fileMap);
        // console.log('All beancount files loaded, total size:', Object.values(fileMap).reduce((sum, c) => sum + c.length, 0));

        // Parse all files together with include resolution.
        await ensureInitialized();
        const parseResult = parseMultiFile(fileMap, mainFileName);

        // validate
        if (parseResult.errors.length > 0) {
            console.log('Parse errors:', parseResult.errors);
            throw new Error('Parsing errors occurred. See console for details.');
        }

        // run queries and cache results:
        const ptaSystem = await settings.get<string>(SettingKeys.ptaSystem) || 'rledger';
        const queries = getQueries(ptaSystem);

        // - payees
        await syncPayees(queries, fileMap, mainFileName);
        
        // - opening balances

        // - accounts with balances?

    } catch (error) {
        console.error('Synchronization error:', error);
        throw error;
    }
}

async function syncPayees(queries: ReturnType<typeof getQueries>, 
    fileMap: Record<string, string>, mainFileName: string) {
    // Cut-off date: same as cashier-sync, 20 years back
    const from = moment().subtract(20, 'years').format(ISODATEFORMAT);
    const payeesQuery = queries.payees(from);

    const payeesResult = queryMultiFile(fileMap, mainFileName, payeesQuery);
    // console.log('Payees query:', payeesQuery);
    console.log('Payees result:', payeesResult);

    // TODO: Cache payees.

}

export { synchronize };
