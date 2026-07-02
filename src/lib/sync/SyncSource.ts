/*
	Generic, source-agnostic sync engine interface. A `SyncSource` is anything
	that can list, read, write, delete, and hash the ledger files on one side
	of a sync — OPFS (`OpfsSource`), a remote peer (`PeerSource`, Peer Protocol
	phase), or later the native filesystem (`FileSystemSource`, deferred).
	See doc/projects/2026-07-02_beancount-peer-sync.md.
*/

/** Metadata-only file record shared by every SyncSource implementation. */
// Index signature required so the type satisfies trystero's DataPayload's { [key: string]: JsonValue } branch
export interface SyncEntry {
	path: string;
	size: number;
	lastModified: number;
	[key: string]: string | number;
}

/**
 * One side of a two-peer sync. `listTree`/`hashFile` never transmit file
 * content — only metadata and digests — so a remote peer can be compared
 * without pulling anything. `writeFile`/`deleteFile` apply an accepted pull
 * locally; in v1 only `OpfsSource` needs a working implementation (push is a
 * later phase — see the project doc's Future section).
 */
export interface SyncSource {
	/** Metadata-only tree scan (glob-filtered, files only) — never hashes. */
	listTree(): Promise<SyncEntry[]>;
	/** Full file content, or undefined if the file no longer exists. */
	readFile(path: string): Promise<string | undefined>;
	/** Overwrites (or creates) the file with the given content. */
	writeFile(path: string, content: string): Promise<void>;
	/** Removes the file. */
	deleteFile(path: string): Promise<void>;
	/**
	 * SHA-256 digest (hex) of the file's own content, or undefined if the file
	 * doesn't exist. Always runs on the device hosting the file, so a peer
	 * only ever returns a digest, never the file content, to verify a match.
	 */
	hashFile(path: string): Promise<string | undefined>;
}
