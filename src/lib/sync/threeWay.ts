/*
	Channel-independent core of sync classification: given the content hash on
	each side and the hashes recorded at the last confirmed sync (the "base"),
	say which side(s) changed. No I/O and no notion of a transport, so every
	sync channel (peer-to-peer, S3, WebDAV, ...) can share the same rules and
	map the result to its own actions (pull/skip, upload/download, ...).

	Hashes are `string | null`; `null` means the file does not exist on that side.
*/

/** The hashes each side held when the two were last known to be in agreement. */
export interface SyncBase {
	local: string | null;
	remote: string | null;
}

/**
 * - `same`: nothing to sync.
 * - `local` / `remote`: only that side changed since the base.
 * - `both`: both sides changed since a common base — a real conflict.
 * - `unrelated`: both sides have the file with different content and there is no
 *   base, so there is no common ancestor to say who is newer. Not proof that both
 *   sides were edited, so channels should not present it as a conflict.
 */
export type Change = 'same' | 'local' | 'remote' | 'both' | 'unrelated';

/**
 * @param base `null` when this path was never synced over this channel. A base
 *   with a `null` half means that side did not have the file at the last sync.
 */
export function compareToBase(
	local: string | null,
	remote: string | null,
	base: SyncBase | null
): Change {
	// Identical content (or absent on both sides) needs no history to confirm.
	if (local === remote) return 'same';
	if (base === null && local !== null && remote !== null) return 'unrelated';

	// Each side is judged against its own half of the base, never against the other
	// side's hash: a manual merge can leave the two sides deliberately different.
	// With no base, an absent side matches "absent" and a present side counts as changed.
	const localChanged = local !== (base?.local ?? null);
	const remoteChanged = remote !== (base?.remote ?? null);
	if (localChanged && remoteChanged) return 'both';
	if (remoteChanged) return 'remote';
	if (localChanged) return 'local';
	return 'same';
}
