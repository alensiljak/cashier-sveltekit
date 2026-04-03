/**
 * Instead of synchronizing with Cashier Server, here we will read the Beancount files
 * from the external filesystem, parse them with Rust Ledger, and run the sync
 * queries, just like with the Cashier Server.
 * Fetch the account opening balances, accounts with balances, commodities, payees.
 * Cache the query results in files in OPFS or IndexDB.

 */

import { settings, SettingKeys } from '$lib/settings';
import { ensureInitialized, parseMultiFile } from '$lib/services/rustledger';

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
    console.log('Full book root:', fullBookRoot, 'Parsed file name:', fileName);
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

async function synchronize() {
    console.log('Synchronization started');

    try {
        // Read the main beancount file and any included files from the filesystem.
        const { fileName: mainFileName, content: mainContent, dirHandle } = await readMainBeancountFile();
        // console.log('Main beancount file loaded, size:', mainContent.length);

        // Extract include filenames from the main file using regex.
        const includeFilenames = parseIncludeFilenames(mainContent);
        // console.log('Include files found:', includeFilenames);

        // Read included files and build the FileMap for parseMultiFile.
        const includedContents = await Promise.all(
            includeFilenames.map(filename => readFileFromDir(dirHandle, filename))
        );
        const fileMap: Record<string, string> = { [mainFileName]: mainContent };
        for (let i = 0; i < includeFilenames.length; i++) {
            fileMap[includeFilenames[i]] = includedContents[i];
        }
        console.log('All beancount files loaded, total size:', Object.values(fileMap).reduce((sum, c) => sum + c.length, 0));

        // Parse all files together with include resolution.
        await ensureInitialized();
        const parseResult = parseMultiFile(fileMap, mainFileName);
        console.log('Parse errors:', parseResult.errors);

        // TODO: validate

        // run queries

        // cache results:
        // - payees
        // - commodities
        // - opening balances
        // - accounts with balances?
    } catch (error) {
        console.error('Synchronization error:', error);
        throw error;
    }
}

export { synchronize };
