/*
	Generic, source-agnostic sync engine interface. A `SyncSource` is anything
	that can list, read, write, and delete the ledger files on one side of a
	sync — OPFS (`OpfsSource`), a remote peer (`PeerSource`, Peer Protocol
	phase), or later the native filesystem (`FileSystemSource`, deferred).
	See doc/projects/2026-07-02_beancount-peer-sync.md.
*/

/**
 * Metadata + content record shared by every SyncSource implementation.
 * `hash` is a SHA-256 digest (hex) of the file's own EOL-normalized content,
 * computed on whichever device hosts the file — a remote peer's `listTree()`
 * response carries only this digest, never the file content, so diff
 * classification can tell real content changes from filesystem-mtime noise
 * (clock skew, a resync rewriting byte-identical content, editors touching
 * a file without changing it) without a separate round trip.
 */
// Index signature required so the type satisfies trystero's DataPayload's { [key: string]: JsonValue } branch
export interface SyncEntry {
	path: string;
	size: number;
	lastModified: number;
	hash: string;
	[key: string]: string | number;
}

/**
 * One side of a two-peer sync. `listTree` never transmits file content —
 * only metadata and a content hash — so a remote peer can be compared
 * without pulling anything. `writeFile`/`deleteFile` apply an accepted pull
 * locally; in v1 only `OpfsSource` needs a working implementation (push is a
 * later phase — see the project doc's Future section).
 */
export interface SyncSource {
	/** Metadata + content-hash tree scan (glob-filtered, files only). */
	listTree(): Promise<SyncEntry[]>;
	/** Full file content, or undefined if the file no longer exists. */
	readFile(path: string): Promise<string | undefined>;
	/** Overwrites (or creates) the file with the given content. */
	writeFile(path: string, content: string): Promise<void>;
	/** Removes the file. */
	deleteFile(path: string): Promise<void>;
}

/**
 * Normalizes text for content-equality checks: CRLF/CR → LF, then drops one
 * trailing newline so "file ends with \n" vs "doesn't" isn't a difference
 * either. Android and Windows/desktop editors disagree on both, so a
 * byte-identical comparison (hashing, the diff modal's "identical" check)
 * flags files as changed even when their content is the same. Comparison
 * only — never applied to what actually gets read/written, so pulled files
 * stay byte-faithful to the peer's copy.
 */
export function normalizeEol(content: string): string {
	return content.replace(/\r\n?/g, '\n').replace(/\n$/, '');
}
